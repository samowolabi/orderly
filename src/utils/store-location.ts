export type AddressInputValue = {
  line1: string;
  line2?: string;

  area: string;
  city: string;
  state: string;
  country_code: string;
  postal_code?: string;

  directions_note?: string;
};

export type AddressPatchValue = {
  line1?: string;
  line2?: string | null;

  area?: string;
  city?: string;
  state?: string;
  country_code?: string;
  postal_code?: string | null;

  directions_note?: string | null;
};

export type CoordinatesInputValue = {
  latitude: number;
  longitude: number;
};

export type AddressRow = {
  address_line1: string;
  address_line2: string | null;

  area: string;
  city: string;
  state: string;
  country_code: string;
  postal_code: string | null;

  directions_note: string | null;

  latitude: number | null;
  longitude: number | null;
};

// Joins structured address input into a geocoder-friendly search string.
export function addressSearchText(address: AddressInputValue) {
  const parts = [address.line1, address.line2, address.area, address.city];
  if (address.state.toLowerCase() !== address.city.toLowerCase()) parts.push(address.state);
  parts.push(address.postal_code, address.country_code);
  return parts.filter(Boolean).join(", ");
}

// Joins normalized address columns into one readable address line.
export function formatAddress(row: AddressRow) {
  const parts = [row.address_line1, row.address_line2, row.area, row.city];
  if (row.state.toLowerCase() !== row.city.toLowerCase()) parts.push(row.state);
  if (row.postal_code) parts.push(row.postal_code);
  if (row.country_code !== "NG") parts.push(row.country_code);
  return parts.filter(Boolean).join(", ");
}

// Builds structured address data and a shareable Google Maps URL.
export function addressView(row: AddressRow) {
  const address = formatAddress(row);
  const hasCoordinates = row.latitude !== null && row.longitude !== null;
  const query = hasCoordinates ? `${row.latitude},${row.longitude}` : address;

  return {
    address,
    address_details: {
      line1: row.address_line1,
      line2: row.address_line2,
      area: row.area,
      city: row.city,
      state: row.state,
      country_code: row.country_code,
      postal_code: row.postal_code,
      directions_note: row.directions_note,
    },
    location: {
      latitude: row.latitude,
      longitude: row.longitude,
      map_url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`,
    },
  };
}
