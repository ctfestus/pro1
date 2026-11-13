/** White surfaces lifted off the gray page by a soft shadow (no borders). Shared by the store pages. */
export const CARD_SHADOW = '0 1px 2px rgba(15,23,42,0.04), 0 10px 30px -14px rgba(15,23,42,0.14)';

/** "AM" from "Ama Mensah", for an avatar with no photo. */
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('');
