// Pure types for the Cal.com booking flow. Kept separate from actions.ts
// because Next 16 forbids non-async exports from "use server" files.

export interface CalcomLink {
  slug: string;
  label: string;
  tagline: string;
  emoji: string;
  url: string;
  template_param_url?: string;
  default_body?: string;
}

export interface EventTypeOption extends CalcomLink {
  eventTypeId: number | null;
  eventTypeSlug: string;
}

export interface SlotOption {
  startIso: string;
  label: string;
  dateKey: string;
  dateLabel: string;
}

export interface CreateBookingInput {
  eventTypeSlug: string;
  slotIso: string;
  clientId: string;
  clientName: string;
  clientEmail: string;
  clientPhone?: string;
  notes?: string;
}

export interface CreateBookingResult {
  ok: boolean;
  bookingUid?: string;
  calcomEventUrl?: string;
  error?: string;
}

export interface SendBookingLinkInput {
  clientId: string;
  eventTypeSlug: string;
  clientName: string;
  clientPhone?: string;
}
