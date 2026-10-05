export const SERVICE_IDS = [
  'cafe-aspan',
  'medical',
  'prayer-room',
  'info-desk',
  'ticket-office',
  'vip-lounge',
  'mother-child',
  'left-luggage',
  'mobility',
  'police',
] as const;

export type ServiceId = (typeof SERVICE_IDS)[number];

const LEGACY_SERVICE_ID_ALIASES: Record<string, ServiceId> = {
  'cafe-lido': 'cafe-aspan',
};

export function normalizeServiceId(value: string): string {
  return LEGACY_SERVICE_ID_ALIASES[value] ?? value;
}

export function isValidServiceId(value: string): value is ServiceId {
  return (SERVICE_IDS as readonly string[]).includes(normalizeServiceId(value));
}
