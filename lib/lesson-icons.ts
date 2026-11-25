// The icons a lesson block can carry (callouts, flip cards, step cards, timeline events, tabs,
// collapsible sections), as stable keys.
//
// Keys are stored in lesson docs and written by the AI, so a key is never renamed or removed --
// add new ones instead. The Phosphor component for each key lives in
// components/lesson/lessonIconMap.tsx, typed against LessonIconKey so the two cannot drift.
//
// DEPENDENCY-FREE (no React, no Phosphor) so the AI routes can read the key list.

type IconGroup = 'data' | 'tools' | 'business' | 'people' | 'learning' | 'status';

interface LessonIconMeta {
  label: string;
  group: IconGroup;
  /** Extra search words for the picker. */
  words: string;
}

export const LESSON_ICON_GROUPS: { id: IconGroup; name: string }[] = [
  { id: 'data', name: 'Data and analysis' },
  { id: 'tools', name: 'Tools and tech' },
  { id: 'business', name: 'Business and money' },
  { id: 'people', name: 'People and communication' },
  { id: 'learning', name: 'Ideas and learning' },
  { id: 'status', name: 'Status' },
];

export const LESSON_ICONS = {
  // Data and analysis
  table: { label: 'Table', group: 'data', words: 'sheet grid rows columns' },
  'chart-bar': { label: 'Bar chart', group: 'data', words: 'graph visual compare' },
  'chart-line': { label: 'Line chart', group: 'data', words: 'graph trend over time' },
  'chart-pie': { label: 'Pie chart', group: 'data', words: 'share proportion' },
  database: { label: 'Database', group: 'data', words: 'sql storage data warehouse' },
  filter: { label: 'Filter', group: 'data', words: 'funnel narrow where' },
  calculate: { label: 'Calculate', group: 'data', words: 'calculator formula maths sum total' },
  formula: { label: 'Formula', group: 'data', words: 'function fx excel' },
  sum: { label: 'Sum', group: 'data', words: 'sigma total aggregate' },
  percent: { label: 'Percent', group: 'data', words: 'rate ratio margin' },
  kpi: { label: 'KPI', group: 'data', words: 'gauge metric dashboard speed' },
  dashboard: { label: 'Dashboard', group: 'data', words: 'grid layout tiles' },
  present: { label: 'Present', group: 'data', words: 'presentation report slide' },
  clean: { label: 'Clean data', group: 'data', words: 'broom tidy duplicates' },
  sort: { label: 'Sort', group: 'data', words: 'order ascending rank' },
  search: { label: 'Search', group: 'data', words: 'magnifying glass find explore' },
  hierarchy: { label: 'Hierarchy', group: 'data', words: 'tree structure org model' },
  network: { label: 'Network', group: 'data', words: 'graph nodes relationships' },
  id: { label: 'ID', group: 'data', words: 'hash key number' },

  // Tools and tech
  excel: { label: 'Excel file', group: 'tools', words: 'spreadsheet xlsx workbook' },
  csv: { label: 'CSV file', group: 'tools', words: 'export data file' },
  sql: { label: 'SQL file', group: 'tools', words: 'query script' },
  python: { label: 'Python file', group: 'tools', words: 'py script notebook' },
  code: { label: 'Code', group: 'tools', words: 'programming developer' },
  terminal: { label: 'Terminal', group: 'tools', words: 'command line console' },
  brain: { label: 'AI', group: 'tools', words: 'brain think model machine learning' },
  robot: { label: 'Bot', group: 'tools', words: 'robot automation agent' },
  magic: { label: 'Magic', group: 'tools', words: 'wand generate automate' },
  cloud: { label: 'Cloud', group: 'tools', words: 'online server hosting' },
  laptop: { label: 'Laptop', group: 'tools', words: 'computer device' },
  cpu: { label: 'Processor', group: 'tools', words: 'cpu chip hardware' },
  browser: { label: 'Browser', group: 'tools', words: 'web page website' },
  link: { label: 'Link', group: 'tools', words: 'url connect' },
  globe: { label: 'Globe', group: 'tools', words: 'web internet world' },
  wifi: { label: 'Wi-Fi', group: 'tools', words: 'internet connection network' },
  lock: { label: 'Security', group: 'tools', words: 'lock password secure private' },
  key: { label: 'Key', group: 'tools', words: 'access api password' },
  bug: { label: 'Bug', group: 'tools', words: 'error debug fix' },
  settings: { label: 'Settings', group: 'tools', words: 'gear configure options' },
  plug: { label: 'Integration', group: 'tools', words: 'plug connect api' },
  version: { label: 'Version', group: 'tools', words: 'git branch history' },

  // Business and money
  money: { label: 'Money', group: 'business', words: 'cash cedi naira shilling rand payment' },
  coins: { label: 'Coins', group: 'business', words: 'money savings revenue' },
  bank: { label: 'Bank', group: 'business', words: 'finance banking loan' },
  wallet: { label: 'Wallet', group: 'business', words: 'money budget spend' },
  card: { label: 'Card payment', group: 'business', words: 'credit debit card pay' },
  receipt: { label: 'Receipt', group: 'business', words: 'expense purchase' },
  invoice: { label: 'Invoice', group: 'business', words: 'bill accounts payable' },
  'mobile-money': { label: 'Mobile money', group: 'business', words: 'phone momo airtime mpesa ussd' },
  cart: { label: 'Shopping', group: 'business', words: 'cart retail ecommerce order' },
  store: { label: 'Store', group: 'business', words: 'shop retail storefront' },
  price: { label: 'Price', group: 'business', words: 'tag discount product' },
  logistics: { label: 'Logistics', group: 'business', words: 'truck delivery supply chain' },
  package: { label: 'Package', group: 'business', words: 'parcel stock inventory' },
  factory: { label: 'Factory', group: 'business', words: 'manufacturing production' },
  agriculture: { label: 'Agriculture', group: 'business', words: 'plant farm crops growth' },
  livestock: { label: 'Livestock', group: 'business', words: 'cow farm animals' },
  nature: { label: 'Environment', group: 'business', words: 'leaf green climate' },
  energy: { label: 'Energy', group: 'business', words: 'sun solar power' },
  water: { label: 'Water', group: 'business', words: 'drop utility' },
  property: { label: 'Property', group: 'business', words: 'house real estate home' },
  transport: { label: 'Transport', group: 'business', words: 'car vehicle mobility' },
  travel: { label: 'Travel', group: 'business', words: 'airplane flight tourism' },
  health: { label: 'Health', group: 'business', words: 'heartbeat medical hospital' },
  'first-aid': { label: 'First aid', group: 'business', words: 'medical care clinic' },
  company: { label: 'Company', group: 'business', words: 'buildings office organisation' },
  briefcase: { label: 'Work', group: 'business', words: 'briefcase job career' },
  deal: { label: 'Deal', group: 'business', words: 'handshake partnership agreement' },
  legal: { label: 'Legal', group: 'business', words: 'scales law compliance' },
  trend: { label: 'Growth', group: 'business', words: 'trend up increase' },
  decline: { label: 'Decline', group: 'business', words: 'trend down decrease drop' },
  rocket: { label: 'Launch', group: 'business', words: 'rocket start growth' },
  announce: { label: 'Announcement', group: 'business', words: 'megaphone marketing campaign' },
  africa: { label: 'Africa', group: 'business', words: 'globe world region market' },
  map: { label: 'Map', group: 'business', words: 'region territory route' },
  location: { label: 'Location', group: 'business', words: 'map pin place branch' },

  // People and communication
  people: { label: 'People', group: 'people', words: 'users group customers' },
  team: { label: 'Team', group: 'people', words: 'users three group' },
  person: { label: 'Person', group: 'people', words: 'user profile individual' },
  student: { label: 'Student', group: 'people', words: 'learner pupil' },
  teacher: { label: 'Teacher', group: 'people', words: 'instructor trainer classroom' },
  profile: { label: 'Profile', group: 'people', words: 'identification card id badge' },
  message: { label: 'Message', group: 'people', words: 'chat comment' },
  conversation: { label: 'Conversation', group: 'people', words: 'chats discussion' },
  email: { label: 'Email', group: 'people', words: 'envelope mail inbox' },
  phone: { label: 'Phone call', group: 'people', words: 'call telephone' },
  video: { label: 'Video call', group: 'people', words: 'camera meeting record' },
  microphone: { label: 'Microphone', group: 'people', words: 'speak audio interview podcast' },
  translate: { label: 'Translate', group: 'people', words: 'language' },
  certificate: { label: 'Certificate', group: 'people', words: 'credential award' },
  graduation: { label: 'Graduation', group: 'people', words: 'cap degree course complete' },
  trophy: { label: 'Trophy', group: 'people', words: 'winner award prize' },
  medal: { label: 'Medal', group: 'people', words: 'badge achievement' },
  heart: { label: 'Heart', group: 'people', words: 'love care favourite' },
  'thumbs-up': { label: 'Thumbs up', group: 'people', words: 'like approve good' },
  smile: { label: 'Smile', group: 'people', words: 'happy smiley customer satisfaction' },

  // Ideas and learning
  tip: { label: 'Idea', group: 'learning', words: 'lightbulb tip insight' },
  book: { label: 'Reading', group: 'learning', words: 'book open read' },
  notebook: { label: 'Notebook', group: 'learning', words: 'notes journal' },
  note: { label: 'Document', group: 'learning', words: 'file text page note' },
  article: { label: 'Article', group: 'learning', words: 'blog post read' },
  write: { label: 'Write', group: 'learning', words: 'pencil edit draft' },
  question: { label: 'Question', group: 'learning', words: 'ask help' },
  info: { label: 'Info', group: 'learning', words: 'information about' },
  puzzle: { label: 'Puzzle', group: 'learning', words: 'problem solve piece' },
  target: { label: 'Goal', group: 'learning', words: 'target aim objective' },
  compass: { label: 'Direction', group: 'learning', words: 'compass navigate explore' },
  path: { label: 'Path', group: 'learning', words: 'journey route steps' },
  flag: { label: 'Milestone', group: 'learning', words: 'flag finish' },
  star: { label: 'Star', group: 'learning', words: 'favourite important' },
  bookmark: { label: 'Remember', group: 'learning', words: 'bookmark save keep' },
  quote: { label: 'Quote', group: 'learning', words: 'quotation saying' },
  watch: { label: 'Watch for', group: 'learning', words: 'eye look notice' },
  clock: { label: 'Time', group: 'learning', words: 'clock duration' },
  calendar: { label: 'Date', group: 'learning', words: 'calendar schedule deadline' },
  hourglass: { label: 'Wait', group: 'learning', words: 'hourglass pending' },
  timer: { label: 'Timer', group: 'learning', words: 'stopwatch timed speed' },
  checklist: { label: 'Checklist', group: 'learning', words: 'tasks list checks' },
  clipboard: { label: 'Brief', group: 'learning', words: 'clipboard task assignment' },
  list: { label: 'List', group: 'learning', words: 'bullets items' },
  compare: { label: 'Compare', group: 'learning', words: 'arrows swap versus' },
  play: { label: 'Play', group: 'learning', words: 'video watch start' },
  listen: { label: 'Listen', group: 'learning', words: 'headphones audio' },
  image: { label: 'Image', group: 'learning', words: 'picture photo' },
  file: { label: 'File', group: 'learning', words: 'document' },
  folder: { label: 'Folder', group: 'learning', words: 'files project' },
  upload: { label: 'Upload', group: 'learning', words: 'submit send' },
  download: { label: 'Download', group: 'learning', words: 'save get resource' },
  share: { label: 'Share', group: 'learning', words: 'network social' },
  sparkles: { label: 'Highlight', group: 'learning', words: 'sparkle new ai magic' },
  zap: { label: 'Fast', group: 'learning', words: 'lightning quick energy' },

  // Status
  success: { label: 'Check', group: 'status', words: 'done correct complete success' },
  verified: { label: 'Verified', group: 'status', words: 'seal approved quality' },
  warning: { label: 'Warning', group: 'status', words: 'caution risk mistake' },
  error: { label: 'Wrong', group: 'status', words: 'x error incorrect fail' },
  avoid: { label: 'Avoid', group: 'status', words: 'prohibited do not stop' },
  shield: { label: 'Best practice', group: 'status', words: 'shield safe protect' },
  tool: { label: 'Practice', group: 'status', words: 'wrench fix tool' },
  hot: { label: 'Hot', group: 'status', words: 'fire trending popular' },
  alarm: { label: 'Alarm', group: 'status', words: 'urgent alert reminder' },
  bell: { label: 'Notification', group: 'status', words: 'bell alert reminder' },
} as const satisfies Record<string, LessonIconMeta>;

export type LessonIconKey = keyof typeof LESSON_ICONS;

export const LESSON_ICON_KEYS = Object.keys(LESSON_ICONS) as LessonIconKey[];

// Keys that older flip cards stored for an icon now held under another key.
const ALIASES: Record<string, LessonIconKey> = {
  lightbulb: 'tip',
  users: 'people',
  growth: 'trend',
};

/** A stored or AI-written icon value as a known key, or '' when it is empty or unknown. */
export function resolveLessonIconKey(raw: unknown): LessonIconKey | '' {
  if (typeof raw !== 'string') return '';
  const value = raw.trim().toLowerCase();
  if (!value) return '';
  if (value in LESSON_ICONS) return value as LessonIconKey;
  return ALIASES[value] ?? '';
}
