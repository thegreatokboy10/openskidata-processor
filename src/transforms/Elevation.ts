import turfLineChunk from "@turf/line-chunk";
import { FeatureType, LiftFeature, RunFeature } from "openskidata-format";

const elevationProfileResolution = 25;

export default function addElevation(
  elevationServerURL: string
): (feature: RunFeature | LiftFeature) => Promise<RunFeature | LiftFeature> {
  return async (feature: RunFeature | LiftFeature) => {
    const coordinates: number[][] = getCoordinates(feature);
    const elevationProfileCoordinates: number[][] =
      getCoordinatesForElevationProfile(feature);

    let elevations: number[];
    try {
      elevations = await fetchElevationsWithBrowserHeaders(
        // Elevation service expects lat,lng order instead of lng,lat of GeoJSON
        Array.from(coordinates)
          .concat(elevationProfileCoordinates)
          .map(([lng, lat]) => [lat, lng]),
        elevationServerURL
      );
    } catch (error) {
      console.log("Failed to load elevations", error);
      return feature;
    }

    const coordinateElevations = elevations.slice(0, coordinates.length);
    const profileElevations = elevations.slice(
      coordinates.length,
      elevations.length
    );

    if (feature.properties.type === FeatureType.Run) {
      feature.properties.elevationProfile =
        profileElevations.length > 0
          ? {
              heights: profileElevations,
              resolution: elevationProfileResolution,
            }
          : null;
    }

    addElevations(feature, coordinateElevations);
    return feature;
  };
}

async function loadElevations(
  coordinates: number[][],
  elevationServerURL: string
): Promise<number[]> {
  const response = await fetch(elevationServerURL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(coordinates),
  });

  if (!response.ok) {
    throw new Error("Failed status code: " + response.status);
  }

  const elevations = await response.json();

  if (coordinates.length !== elevations.length) {
    throw new Error(
      "Number of coordinates (" +
        coordinates.length +
        ") is different than number of elevations (" +
        elevations.length +
        ")"
    );
  }

  return elevations;
}

async function fetchElevationsWithBrowserHeaders(
  coordinates: number[][],
  elevationServerURL: string
): Promise<number[]> {
  const elevations: number[] = [];
  const elevationCache = new Map<string, number>(); // Cache to reduce redundant requests
  const maxRetryTime = 600_000; // 10 minutes in milliseconds

  for (const [lat, lng] of coordinates) {
    let success = false;
    let elevation: number | null = null;
    const cacheKey = `${lat},${lng}`;
    let startTime = Date.now();
    let attempts = 0;
    let retryDelay = 1000; // Initial delay (1 second)

    while (!success) {
      try {
        // If 10 minutes have passed, stop retrying and mark as failed
        if (Date.now() - startTime > maxRetryTime) {
          console.error(`Timeout: Failed to fetch elevation for (${lat}, ${lng}) after 10 minutes.`);
          break;
        }

        // Use cache if available
        if (elevationCache.has(cacheKey)) {
          elevations.push(elevationCache.get(cacheKey)!);
          success = true;
          break;
        }

        // Introduce a random delay to simulate human behavior 
        const randomDelay = Math.random() * (10000 - 7000) + 7000;
        await new Promise(resolve => setTimeout(resolve, randomDelay));

        const response = await fetch(`${elevationServerURL}/api/?lat=${lat}&lng=${lng}`, {
          method: "GET",
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": "https://www.google.com/",
            "DNT": "1", // Do Not Track
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
          },
        });

        if (response.status === 429) {
          // Rate limit hit, wait using exponential backoff
          console.warn(`Rate limit hit for (${lat}, ${lng}). Retrying in ${retryDelay}ms...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          retryDelay = Math.min(retryDelay * 2, 60000); // Exponential backoff (capped at 60s)
          attempts++;
          continue;
        }

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} for (${lat}, ${lng})`);
        }

        elevation = await response.json(); // Expecting a direct number response
        if (typeof elevation !== "number") {
          throw new Error(`Invalid response type for (${lat}, ${lng}): ${elevation}`);
        }

        // Cache the elevation data
        elevationCache.set(cacheKey, elevation);
        success = true;
        elevations.push(elevation);
      } catch (error) {
        console.error(`Attempt ${attempts + 1} failed for (${lat}, ${lng}):`, error);
        attempts++;
      }
    }

    if (!success) {
      console.error(`Failed to fetch elevation for (${lat}, ${lng}) after 10 minutes.`);
      elevations.push(NaN);
    }
  }

  return elevations;
}


function getCoordinates(feature: RunFeature | LiftFeature) {
  let coordinates: number[][];
  switch (feature.geometry.type) {
    case "Point":
      coordinates = [feature.geometry.coordinates];
      break;
    case "LineString":
      coordinates = feature.geometry.coordinates;
      break;
    case "MultiLineString":
    case "Polygon":
      coordinates = feature.geometry.coordinates.flat();
      break;
    case "MultiPolygon":
      coordinates = feature.geometry.coordinates.flat().flat();
      break;
    default:
      throw "Geometry type " + feature.geometry.type + " not implemented";
  }

  // Remove elevation in case it was already added to this point
  return coordinates.map((coordinate) => [coordinate[0], coordinate[1]]);
}

function getCoordinatesForElevationProfile(feature: RunFeature | LiftFeature) {
  if (feature.properties.type === FeatureType.Lift) {
    return [];
  }

  if (feature.geometry.type !== "LineString") {
    return [];
  }

  const subfeatures = turfLineChunk(
    feature.geometry,
    elevationProfileResolution,
    { units: "meters" }
  ).features;
  const points: [number, number][] = [];
  for (let subline of subfeatures) {
    const geometry = subline.geometry;
    if (geometry) {
      const point = geometry.coordinates[0];
      points.push([point[0], point[1]]);
    }
  }
  if (subfeatures.length > 0) {
    const geometry = subfeatures[subfeatures.length - 1].geometry;
    if (geometry) {
      const coords = geometry.coordinates;
      if (coords.length > 1) {
        const point = coords[coords.length - 1];
        points.push([point[0], point[1]]);
      }
    }
  }

  return points;
}

function addElevations(
  feature: RunFeature | LiftFeature,
  elevations: number[]
) {
  let i = 0;
  switch (feature.geometry.type) {
    case "Point":
      return addElevationToCoords(feature.geometry.coordinates, elevations[i]);
    case "LineString":
      return feature.geometry.coordinates.forEach((coords) => {
        addElevationToCoords(coords, elevations[i]);
        i++;
      });
    case "MultiLineString":
    case "Polygon":
      return feature.geometry.coordinates.forEach((coordsSet) => {
        coordsSet.forEach((coords) => {
          addElevationToCoords(coords, elevations[i]);
          i++;
        });
      });
    case "MultiPolygon":
      return feature.geometry.coordinates.forEach((coordsSet) => {
        coordsSet.forEach((innerCoordsSet) => {
          innerCoordsSet.forEach((coords) => {
            addElevationToCoords(coords, elevations[i]);
            i++;
          });
        });
      });
    default:
      throw "Geometry type " + feature.geometry.type + " not implemented";
  }
}

function addElevationToCoords(coords: number[], elevation: number) {
  if (coords.length === 3) {
    // The elevation was already added to this point (this can happen with polygons where the first and last coordinates are the same object in memory)
    return;
  }

  coords.push(elevation);
}
