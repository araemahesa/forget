export type IconName = 'account' | 'activity' | 'alert' | 'check' | 'cube' | 'download' | 'library' | 'moon' | 'refresh' | 'save' | 'search' | 'settings' | 'spark' | 'sun' | 'tools' | 'workspace' | 'world' | 'arrow' | 'chevron' | 'image' | 'layers' | 'shirt' | 'wave' | 'music' | 'film' | 'message' | 'mountain' | 'building' | 'grid' | 'link' | 'clock' | 'plus' | 'close' | 'panel' | 'command' | 'upload' | 'database' | 'chart' | 'gauge' | 'terminal' | 'copy' | 'inspect';

export function Icon({ name, label }: { name: IconName; label?: string }) {
  return (
    <svg aria-hidden={!label} aria-label={label} className="icon" fill="none" role={label ? 'img' : undefined} stroke="currentColor" viewBox="0 0 24 24">
      {name === 'account' ? <><circle cx="12" cy="8" r="4" strokeWidth="1.7" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" strokeWidth="1.7" strokeLinecap="round" /></> : null}
      {name === 'download' ? <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 20h14" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /> : null}
      {name === 'save' ? <path d="M5 4h12l2 2v14H5V4Zm3 0v5h7V4M8 20v-6h8v6" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /> : null}
      {name === 'spark' ? <path d="m12 3 1.8 6.2L20 11l-6.2 1.8L12 19l-1.8-6.2L4 11l6.2-1.8L12 3Z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /> : null}
      {name === 'workspace' ? <path d="M3 7h7l2 2h9v11H3V7Zm0 0V4h7l2 3" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /> : null}
      {name === 'activity' ? <path d="M3 12h4l3-8 4 16 3-8h4" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /> : null}
      {name === 'settings' ? <><path d="m9.5 3-.6 2.2-1.5.9-2.2-.6-2.5 4.3 1.6 1.6v1.7l-1.6 1.6L5.2 19l2.2-.6 1.5.9.6 2.2h5l.6-2.2 1.5-.9 2.2.6 2.5-4.3-1.6-1.6v-1.7l1.6-1.6-2.5-4.3-2.2.6-1.5-.9-.6-2.2h-5Z" strokeLinejoin="round" strokeWidth="1.7" /><circle cx="12" cy="12.25" r="3" strokeWidth="1.7" /></> : null}
      {name === 'cube' ? <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 9 8-4.5M12 12 4 7.5M12 12v9" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /> : null}
      {name === 'world' ? <><circle cx="12" cy="12" r="8.5" strokeWidth="1.8" /><path d="M3.8 9h16.4M3.8 15h16.4M12 3.5c2.2 2.4 3.3 5.2 3.3 8.5S14.2 18.1 12 20.5C9.8 18.1 8.7 15.3 8.7 12S9.8 5.9 12 3.5Z" strokeLinecap="round" strokeWidth="1.6" /></> : null}
      {name === 'tools' ? <><path d="m14.5 5.5 4-2 2 2-2 4-2.5.5-5.7 5.7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /><path d="m5.2 18.8 3.1-3.1M3.5 20.5l2-2" strokeLinecap="round" strokeWidth="1.8" /><circle cx="5.2" cy="18.8" r="1.8" strokeWidth="1.6" /></> : null}
      {name === 'library' ? <><path d="M4 5.5h12a2 2 0 0 1 2 2v11H6a2 2 0 0 1-2-2v-11Z" strokeLinejoin="round" strokeWidth="1.8" /><path d="M6 18.5a2 2 0 0 0 2 2h10V7.5" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /><path d="M8 9.5h6M8 13h4" strokeLinecap="round" strokeWidth="1.6" /></> : null}
      {name === 'check' ? <><circle cx="12" cy="12" r="8.5" strokeWidth="1.8" /><path d="m8 12 2.5 2.5L16.5 9" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></> : null}
      {name === 'alert' ? <><circle cx="12" cy="12" r="8.5" strokeWidth="1.8" /><path d="M12 7v5m0 3.5v.1" strokeLinecap="round" strokeWidth="1.8" /></> : null}
      {name === 'refresh' ? <path d="M20 11a8 8 0 0 0-14.7-3L3 10m0 0V5m0 5h5M4 13a8 8 0 0 0 14.7 3L21 14m0 0v5m0-5h-5" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" /> : null}
      {name === 'sun' ? <><circle cx="12" cy="12" r="3.5" strokeWidth="1.8" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" strokeLinecap="round" strokeWidth="1.7" /></> : null}
      {name === 'moon' ? <path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /> : null}
      {name === 'search' ? <><circle cx="10.8" cy="10.8" r="6.3" strokeWidth="1.8" /><path d="m16 16 4.5 4.5" strokeLinecap="round" strokeWidth="1.8" /></> : null}
      {name === 'arrow' ? <path d="M5 12h14m-5-5 5 5-5 5" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /> : null}
      {name === 'chevron' ? <path d="m9 5 7 7-7 7" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /> : null}
      {name === 'image' ? <><rect x="3" y="4" width="18" height="16" rx="3" strokeWidth="1.7" /><circle cx="8" cy="9" r="1.5" strokeWidth="1.7" /><path d="m4 17 5-5 4 4 3-3 4 4" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></> : null}
      {name === 'layers' ? <><path d="m12 3 10 5-10 5L2 8l10-5Zm-9 9 9 4.5 9-4.5M3 16l9 4.5 9-4.5" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></> : null}
      {name === 'shirt' ? <path d="m8 3-6 4 3 5 3-2v11h8V10l3 2 3-5-6-4c0 4-8 4-8 0Z" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /> : null}
      {name === 'wave' ? <path d="M3 10v4m4-8v12m5-16v20m5-16v12m4-8v4" strokeWidth="1.7" strokeLinecap="round" /> : null}
      {name === 'music' ? <><path d="M9 18V5l11-2v13M9 8l11-2" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /><ellipse cx="6" cy="18" rx="3" ry="2.5" strokeWidth="1.7" /><ellipse cx="17" cy="16" rx="3" ry="2.5" strokeWidth="1.7" /></> : null}
      {name === 'film' ? <><rect x="3" y="5" width="18" height="15" rx="2" strokeWidth="1.7" /><path d="M3 10h18M7 5l3 5m3-5 3 5M3 5l3-3m4 3 3-3m4 3 3-3" strokeWidth="1.7" strokeLinecap="round" /></> : null}
      {name === 'message' ? <path d="M21 12a8 8 0 0 1-8 8H4l-1 2V11a8 8 0 0 1 8-8h2a8 8 0 0 1 8 9ZM7 9h10M7 13h7" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /> : null}
      {name === 'mountain' ? <path d="m2 20 7-16 5 10 3-6 5 12H2Zm4-9 3 2 2-2" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /> : null}
      {name === 'building' ? <><path d="M4 21V7h8v14M12 3h8v18H2m6-10v2m0 3v2m8-11v2m0 2v2m0 2v2" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></> : null}
      {name === 'grid' ? <><rect x="3" y="3" width="7" height="7" rx="1.5" strokeWidth="1.7" /><rect x="14" y="3" width="7" height="7" rx="1.5" strokeWidth="1.7" /><rect x="3" y="14" width="7" height="7" rx="1.5" strokeWidth="1.7" /><rect x="14" y="14" width="7" height="7" rx="1.5" strokeWidth="1.7" /></> : null}
      {name === 'link' ? <path d="m10 14 4-4m-6 6-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 2 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 -1)" strokeWidth="1.7" strokeLinecap="round" /> : null}
      {name === 'clock' ? <><circle cx="12" cy="12" r="9" strokeWidth="1.7" /><path d="M12 7v5l3 2" strokeWidth="1.7" strokeLinecap="round" /></> : null}
      {name === 'plus' ? <path d="M12 5v14M5 12h14" strokeWidth="1.7" strokeLinecap="round" /> : null}
      {name === 'close' ? <path d="m6 6 12 12M18 6 6 18" strokeWidth="1.7" strokeLinecap="round" /> : null}
      {name === 'panel' ? <><rect x="3" y="4" width="18" height="16" rx="2" strokeWidth="1.7" /><path d="M15 4v16" strokeWidth="1.7" /></> : null}
      {name === 'command' ? <path d="M9 7V5a2 2 0 1 0-2 2h10a2 2 0 1 0-2-2v14a2 2 0 1 0 2-2H7a2 2 0 1 0 2 2V7Z" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /> : null}
      {name === 'upload' ? <path d="M12 16V3m-4 4 4-4 4 4M4 16v5h16v-5" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /> : null}
      {name === 'database' ? <><ellipse cx="12" cy="5" rx="8" ry="3" strokeWidth="1.7" /><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0" strokeWidth="1.7" /></> : null}
      {name === 'gauge' ? <><path d="M5 19a9 9 0 1 1 14 0M12 4v2M5 9l2 1m12-1-2 1m-5 4 5-6" strokeWidth="1.7" strokeLinecap="round" /><circle cx="12" cy="14" r="2" strokeWidth="1.7" /></> : null}
      {name === 'chart' ? <><path d="M4 3v18h17M8 16v-5m5 5V7m5 9V4" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></> : null}
      {name === 'terminal' ? <><path d="m4 17 6-6-6-6M12 19h8" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></> : null}
      {name === 'copy' ? <><rect x="9" y="9" width="13" height="13" rx="2" strokeWidth="1.7" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" strokeWidth="1.7" strokeLinecap="round" /></> : null}
      {name === 'inspect' ? <><circle cx="11" cy="11" r="7" strokeWidth="1.7" /><path d="m16 16 5 5M8 11h6M11 8v6" strokeWidth="1.7" strokeLinecap="round" /></> : null}
    </svg>
  );
}
