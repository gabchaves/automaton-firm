/**
 * Deterministic, human-shaped trader names. Same seed -> same name, always
 * (mulberry32 is the only RNG allowed anywhere in this codebase).
 */

import { mulberry32 } from "../trading/deciders.js";

const FIRST_NAMES = [
  "Ana", "Bruno", "Camila", "Diego", "Elisa", "Felipe", "Gabriela", "Heitor",
  "Isabela", "João", "Karina", "Lucas", "Mariana", "Nicolas", "Olívia", "Pedro",
  "Quésia", "Rafael", "Sofia", "Thiago", "Úrsula", "Vinícius", "Yasmin", "Zeca",
];

const SURNAMES = [
  "Almeida", "Barbosa", "Cardoso", "Duarte", "Esteves", "Ferreira", "Gonçalves", "Hoffmann",
  "Ibrahim", "Junqueira", "Klein", "Lima", "Moraes", "Nogueira", "Oliveira", "Ponte",
  "Queiroz", "Ribeiro", "Silveira", "Teixeira", "Uchoa", "Vasconcelos", "Xavier", "Zanetti",
];

export function traderName(seed: number): string {
  const rng = mulberry32(seed);
  const first = FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)];
  const last = SURNAMES[Math.floor(rng() * SURNAMES.length)];
  return `${first} ${last}`;
}
