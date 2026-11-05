const PATHS = {
  billing: 'M4 4h16v4H4zM4 10h16v10H4zM8 14h8M8 17h5',
  orders: 'M6 2h9l3 3v17H6zM15 2v3h3M9 12h6M9 16h6M9 8h3',
  lab: 'M9 3h6M10 3v6.5L4.5 19a1.5 1.5 0 0 0 1.3 2.2h12.4a1.5 1.5 0 0 0 1.3-2.2L14 9.5V3M7.5 15h9',
  reports: 'M4 20V10M10 20V4M16 20v-7M3 20h18',
  masters: 'M12 2l1.5 3 3.3.5-2.4 2.3.6 3.3L12 9.5 8.9 11.1l.6-3.3-2.4-2.3 3.3-.5zM12 15v7M8 22h8',
  tickets: 'M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z',
  branding: 'M4 5h16v12H4zM4 17l4-5 3 3 4-6 5 8M9 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 7v5l3 3',
  calendar: 'M7 2v3M17 2v3M3.5 9h17M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  building: 'M4 21V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v16M14 21V9a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v12M8 9h0M8 13h0M8 17h0',
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'M6 6l12 12M18 6L6 18',
  invoice: 'M6 2h12a1 1 0 0 1 1 1v18l-3-2-2 2-2-2-2 2-2-2-3 2V3a1 1 0 0 1 1-1zM8 7h8M8 11h8M8 15h5',
  home: 'M3 11l9-8 9 8M5 10v10h14V10M9 21v-6h6v6',
  dashboard: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  team: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 21v-1a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v1M17 5.1a3 3 0 0 1 0 5.8M23 21v-1a5 5 0 0 0-4-4.9',
  plug: 'M9 2v4M15 2v4M6 8h12l-1 4a5 5 0 0 1-10 0zM8 16v2a4 4 0 0 0 8 0v-2',
  lock: 'M6 11V7a6 6 0 0 1 12 0v4M5 11h14v10H5zM12 15v3',
  logout: 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  print: 'M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-2M6 14h12v7H6z',
  sparkle: 'M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8z',
  edit: 'M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z',
  refund: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5',
  percent: 'M19 5L5 19M7.5 7a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM16.5 22a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3',
  check: 'M5 12l5 5L20 7',
  pin: 'M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
};

export function Icon({ name, size = 20, ...rest }) {
  const d = PATHS[name];
  if (!d) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...rest}>
      <path d={d} />
    </svg>
  );
}
