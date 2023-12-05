import { createWriteStream } from "fs";
import merge from "merge2";
import { FeatureType } from "openskidata-format";
import { Readable } from "stream";
import StreamToPromise from "stream-to-promise";
import { Config } from "./Config";
import clusterSkiAreas from "./clustering/ClusterSkiAreas";
import { DataPaths, getPath } from "./io/GeoJSONFiles";
import { readGeoJSONFeatures } from "./io/GeoJSONReader";
import addElevation from "./transforms/Elevation";
import toFeatureCollection from "./transforms/FeatureCollection";
import { formatLift } from "./transforms/LiftFormatter";
import * as MapboxGLFormatter from "./transforms/MapboxGLFormatter";
import { formatRun } from "./transforms/RunFormatter";
import { InputSkiAreaType, formatSkiArea } from "./transforms/SkiAreaFormatter";

import {
  SkiAreaSiteProvider,
  addSkiAreaSites,
} from "./transforms/SkiAreaSiteProvider";
import {
  accumulate,
  flatMap,
  map,
  mapAsync,
} from "./transforms/StreamTransforms";
import { RunNormalizerAccumulator } from "./transforms/accumulator/RunNormalizerAccumulator";

export default async function prepare(paths: DataPaths, config: Config) {
  const siteProvider = new SkiAreaSiteProvider();
  siteProvider.loadSites(paths.input.osmJSON.skiAreaSites);

  console.log("Processing ski areas...");

  await StreamToPromise(
    merge([
      readGeoJSONFeatures(paths.input.geoJSON.skiAreas).pipe(
        flatMap(formatSkiArea(InputSkiAreaType.OPENSTREETMAP_LANDUSE))
      ),
      Readable.from(siteProvider.getGeoJSONSites()),
      readGeoJSONFeatures(paths.input.geoJSON.skiMapSkiAreas).pipe(
        flatMap(formatSkiArea(InputSkiAreaType.SKIMAP_ORG))
      ),
    ])
      .pipe(toFeatureCollection())
      .pipe(
        createWriteStream(
          config.arangoDBURLForClustering
            ? paths.intermediate.skiAreas
            : paths.output.skiAreas
        )
      )
  );

  console.log("Processing runs...");

  await StreamToPromise(
    readGeoJSONFeatures(paths.input.geoJSON.runs)
      .pipe(flatMap(formatRun))
      .pipe(map(addSkiAreaSites(siteProvider)))
      // write stream here
      // do topo conversion in a separate command
      // then open the topojson separately and normalize
      .pipe(accumulate(new RunNormalizerAccumulator()))
      .pipe(
        mapAsync(
          config.elevationServerURL
            ? addElevation(config.elevationServerURL)
            : null,
          10
        )
      )
      .pipe(toFeatureCollection())
      .pipe(
        createWriteStream(
          config.arangoDBURLForClustering
            ? paths.intermediate.runs
            : paths.output.runs
        )
      )
  );

  console.log("Processing lifts...");

  await StreamToPromise(
    readGeoJSONFeatures(paths.input.geoJSON.lifts)
      .pipe(flatMap(formatLift))
      .pipe(map(addSkiAreaSites(siteProvider)))
      .pipe(
        mapAsync(
          config.elevationServerURL
            ? addElevation(config.elevationServerURL)
            : null,
          10
        )
      )
      .pipe(toFeatureCollection())
      .pipe(
        createWriteStream(
          config.arangoDBURLForClustering
            ? paths.intermediate.lifts
            : paths.output.lifts
        )
      )
  );

  if (config.arangoDBURLForClustering) {
    console.log("Clustering ski areas...");
    await clusterSkiAreas(
      paths.intermediate,
      paths.output,
      config.arangoDBURLForClustering,
      config.geocodingServer
    );
  }

  console.log("Formatting for maps...");

  await Promise.all(
    [FeatureType.SkiArea, FeatureType.Lift, FeatureType.Run].map((type) => {
      return StreamToPromise(
        readGeoJSONFeatures(getPath(paths.output, type))
          .pipe(flatMap(MapboxGLFormatter.formatter(type)))
          .pipe(toFeatureCollection())
          .pipe(createWriteStream(getPath(paths.output.mapboxGL, type)))
      );
    })
  );

  console.log("Done preparing");
}
