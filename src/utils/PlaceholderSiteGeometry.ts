import { OSMSkiAreaSite } from "../features/SkiAreaFeature";

// Geometry that's used temporarily as a placeholder. The real geometry (based on member objects) is added later, during the clustering stage.
export default function placeholderSiteGeometry(
  site: OSMSkiAreaSite
): GeoJSON.Point {
  return { type: "Point", coordinates: [360, 360, site.id] };
}
