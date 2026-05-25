// Curated short list of IANA timezones for the UI pickers. The full IANA
// database is ~600 entries — overkill for a clinical site app. Users in
// unlisted regions still work via the "Use browser timezone" fallback
// (empty-string value → caller falls back to Intl.DateTimeFormat()).

export interface TimezoneOption {
  /** IANA name, or empty string for "use browser default". */
  value: string;
  label: string;
}

export const TIMEZONE_OPTIONS: TimezoneOption[] = [
  { value: '',                    label: 'Use browser timezone' },
  { value: 'America/Los_Angeles', label: 'Pacific (PST/PDT)' },
  { value: 'America/Denver',      label: 'Mountain (MST/MDT)' },
  { value: 'America/Chicago',     label: 'Central (CST/CDT)' },
  { value: 'America/New_York',    label: 'Eastern (EST/EDT)' },
  { value: 'UTC',                 label: 'UTC' },
  { value: 'Europe/London',       label: 'London (GMT/BST)' },
  { value: 'Europe/Paris',        label: 'Central Europe (CET/CEST)' },
  { value: 'Asia/Tokyo',          label: 'Japan (JST)' },
];
