import { InputRunFeature, InputRunProperties } from "../features/RunFeature";
import { formatRun } from "./RunFormatter";

describe("RunFormatter", () => {
  it("filters out runs with 'piste:abandoned' tag", () => {
    const run = formatRun(
      inputRun({
        id: "way/1",
        "piste:type": "downhill",
        "piste:abandoned": "yes",
      })
    );
    expect(run).toBeNull();
  });

  it("filters out runs with lifecycle prefix", () => {
    const run = formatRun(
      inputRun({ id: "way/1", "proposed:piste:type": "downhill" })
    );
    expect(run).toBeNull();
  });

  it("formats simple run", () => {
    const run = formatRun(inputRun({ id: "way/1", "piste:type": "downhill" }));
    expect(run!.properties).toMatchInlineSnapshot(`
      Object {
        "color": "hsl(0, 0%, 35%)",
        "colorName": "grey",
        "description": null,
        "difficulty": null,
        "gladed": null,
        "grooming": null,
        "id": "64e1be16905be0666594b5c433d4aa1aa1a64e5f",
        "lit": null,
        "name": null,
        "oneway": null,
        "patrolled": null,
        "ref": null,
        "skiAreas": Array [],
        "sources": Array [
          Object {
            "id": "way/1",
            "type": "openstreetmap",
          },
        ],
        "status": "operating",
        "type": "run",
        "uses": Array [
          "downhill",
        ],
      }
    `);
  });

  it("uses piste name instead of other name", () => {
    const run = formatRun(
      inputRun({
        id: "way/1",
        "piste:type": "downhill",
        "piste:name": "🇫🇷 Nom de la piste",
        "piste:name:en": "Run name",
        name: "Name that shouldn't be shown",
      })
    );
    expect(run!.properties.name).toMatchInlineSnapshot(
      `"🇫🇷 Nom de la piste, Run name"`
    );
  });
});

function inputRun(properties: InputRunProperties): InputRunFeature {
  return {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: [
        [0, 0],
        [1, 1],
      ],
    },
    properties: properties,
  };
}
