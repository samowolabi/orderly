export class RoutingProviderUnavailable extends Error {}

export type Coordinates = {
  latitude: number;
  longitude: number;
};

export type DrivingRoute = {
  distanceMeters: number;
  durationSeconds: number;
};

export interface RoutingProvider {
  readonly name: string;

  // Returns the driving distance and time between two points with current traffic,
  // or null when there's no road route between them.
  drivingRoute(origin: Coordinates, destination: Coordinates): Promise<DrivingRoute | null>;
}
