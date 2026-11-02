export const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Great-circle distance in meters between two points in decimal degrees.
 *
 * The operation order reproduces the official answers bit for bit: the
 * differences are taken in degrees before conversion, the conversion is
 * `(x * Math.PI) / 180`, each sin² is a single term multiplied by the cosine
 * product, and the result uses `asin`. Algebraically equivalent variants
 * differ in the last bits (spec 002, plan section 4).
 */
export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const sinHalfDeltaLat = Math.sin(toRadians(lat2 - lat1) / 2);
  const sinHalfDeltaLon = Math.sin(toRadians(lon2 - lon1) / 2);
  const a =
    sinHalfDeltaLat ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * sinHalfDeltaLon ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(a));
}
