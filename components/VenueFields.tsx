'use client';

/**
 * The in-person location in both event editors: a venue name and an optional subtitle (an area,
 * town or street). Stored together as the event's one location, "Venue, subtitle", which emails,
 * calendar entries and map directions already use whole. The public page splits it back at the
 * first comma (lib/events/public-event.ts splitVenue), so a comma in the name itself is replaced.
 */
import { useState } from 'react';
import { MapPin } from 'lucide-react';
import { joinVenue, splitVenue } from '@/lib/events/public-event';

export function VenueFields({ location, onChange, inputClass, inputStyle, iconColor }: {
  location: string;
  onChange: (location: string) => void;
  inputClass: string;
  inputStyle: React.CSSProperties;
  iconColor: string;
}) {
  // Local while typing: rebuilding the boxes from the stored string on every keystroke would move
  // a subtitle typed before the name into the name box.
  const [fields, setFields] = useState(() => {
    const v = splitVenue(location.trim() || null);
    return { name: v?.name ?? '', subtitle: v?.address ?? '' };
  });
  const set = (next: { name: string; subtitle: string }) => {
    setFields(next);
    onChange(joinVenue(next.name, next.subtitle));
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: iconColor }}>
          <MapPin className="w-4 h-4" />
        </span>
        <input type="text" value={fields.name} placeholder="Venue name"
          onChange={e => set({ ...fields, name: e.target.value.replace(/,/g, ' ') })}
          className={`${inputClass} pl-9`} style={inputStyle} />
      </div>
      <input type="text" value={fields.subtitle} placeholder="Subtitle, e.g. area, town or street (optional)"
        onChange={e => set({ ...fields, subtitle: e.target.value })}
        className={inputClass} style={inputStyle} />
    </div>
  );
}
