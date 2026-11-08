export type DashboardIconName =
  | "home"
  | "payment"
  | "calendar"
  | "people"
  | "chart"
  | "wallet"
  | "search"
  | "plus"
  | "arrow"
  | "arrow-up-right"
  | "arrow-up"
  | "check"
  | "waves"
  | "dollar"
  | "close"
  | "balance"
  | "sponsor"
  | "leaf";

const paths: Record<DashboardIconName, string> = {
  home: "m3 10 9-7 9 7v10H3V10Zm6 10v-7h6v7",
  payment: "M3 5h18v14H3V5Zm0 5h18M7 15h4",
  calendar: "M4 6h16v15H4V6Zm3-3v6m10-6v6M4 11h16",
  people:
    "M16 21v-3a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v3m17 0v-3a4 4 0 0 0-3-4M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm7 0a4 4 0 0 1 0 8",
  chart: "M3 13h4v8H3v-8Zm7-5h4v13h-4V8Zm7-5h4v18h-4V3Z",
  wallet: "M20 7H4V4h14v3M4 7v13h17V7H4Zm11 5h6v4h-6v-4Z",
  search: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 6 6",
  plus: "M12 4v16M4 12h16",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  "arrow-up-right": "M6 18 18 6M6 6h12v12",
  "arrow-up": "M12 20V4m-6 6 6-6 6 6",
  check: "m5 12 4 4L19 6",
  waves: "M3 8c3-5 6 5 9 0s6 5 9 0M3 16c3-5 6 5 9 0s6 5 9 0",
  dollar: "M12 2v20m5-16H9a4 4 0 0 0 0 8h6a4 4 0 0 1 0 8H6",
  close: "m6 6 12 12M6 18 18 6",
  balance:
    "M4 6c0-5 16-5 16 0s-16 5-16 0Zm0 0v6c0 5 16 5 16 0V6M4 12v6c0 5 16 5 16 0v-6",
  sponsor: "M12 3 20 6v5c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10V6l8-3Zm-3 9 2 2 4-4",
  leaf: "M5 20C4 8 12 3 21 3c0 12-6 16-13 14m-5 4L17 7",
};

export function DashboardIcon({ name }: { name: DashboardIconName }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
