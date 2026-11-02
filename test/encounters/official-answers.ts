import { readFileSync } from "node:fs";

// Compiled tests run from dist/test/encounters; fixtures stay in the source tree.
export const FIXTURES = new URL("../../../test/fixtures/official/", import.meta.url);

export interface OfficialEncounter {
  readonly tipo: string;
  readonly monitoradosEncontro: readonly [number, number];
  readonly timestamp: string;
  readonly posicoes: Readonly<Record<string, { readonly lat: number; readonly lon: number }>>;
  readonly distanciaMetros: number;
}

export function readOfficialAnswers(name: string): OfficialEncounter[] {
  return JSON.parse(readFileSync(new URL(name, FIXTURES), "utf8")) as OfficialEncounter[];
}
