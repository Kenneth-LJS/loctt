import type { LucideIcon } from "lucide-react";
import {
  Activity, AlignLeft, Anchor, Apple, Archive, ArrowDown, ArrowLeft, ArrowRight,
  ArrowUp, Asterisk, Atom, AtSign, Award, Ban, Battery, Beaker, Bell, Bike,
  Bold, Bookmark, BookOpen, Bot, Braces, Brain, Briefcase, Brush, Bug,
  Building, Calendar, CalendarDays, Camera, Car, ChartBar, ChartLine, ChartPie,
  Check, ChevronRight, Circle, CircleAlert, CircleCheck, CircleDot, CircleHelp,
  CirclePlay, CircleStop, CircleX, Clipboard, ClipboardList, Clock, Cloud,
  CloudRain, Code, Coffee, Columns3, Compass, Copy, CornerDownRight, Cpu,
  CreditCard, Database, Diamond, DollarSign, Download, Droplet, Dumbbell,
  Eraser, ExternalLink, Eye, EyeOff, FileText, Filter, Fingerprint, Flag,
  Flame, FlaskConical, Folder, Footprints, Forward, Frown, Gavel, Ghost, Gift,
  GitBranch, GitMerge, GitPullRequest, Globe, GraduationCap, Grid3x3, Hammer,
  Handshake, HardDrive, Hash, Heart, HeartHandshake, Hexagon, Highlighter,
  Hourglass, IdCard, Image, Inbox, Infinity as InfinityIcon, Info, Italic, Key,
  Laptop, Layers, LayoutGrid, Leaf, LifeBuoy, Lightbulb, Link, Link2, List,
  ListOrdered, Lock, Mail, Map as MapIcon, MapPin, Maximize, Megaphone, Meh,
  MessageSquare, Mic, Microscope, Minimize, Minus, Monitor, Moon, Mountain,
  Move, Music, Newspaper, Octagon, Package, PaintBucket, Palette, Paperclip,
  Pause, Pencil, PenTool, Percent, Phone, Pin, Pizza, Plane, Play, Plug,
  Plus, Power, Printer, Quote, Radio, Redo2, RefreshCw, Repeat, Reply, Rocket,
  Rows3, Ruler, Save, Scale, Scissors, Search, Send, Server, Settings, Share2,
  Shield, ShieldCheck, Ship, ShoppingCart, Shuffle, Signature, Siren, Skull,
  Smartphone, Smile, Snowflake, Sparkles, Square, Stamp, Star, Sun, Sunrise,
  Sunset, Tag, Tags, Target, Terminal as CodeBlock, Terminal, ThumbsDown,
  ThumbsUp, Timer,   Trash2, TreePine, TrendingDown, TrendingUp, Triangle, TriangleAlert,
Trophy, Truck, Type, Undo2, Unlink, Unlock, Upload, User, UserCheck,
  UserPlus, Users, UsersRound, UserX, Utensils, Video, Waves, Wifi, Wind, Wine,
  Wrench, X, Zap,
} from "lucide-react";

/**
 * K104 — the catalog of Lucide icons the picker offers, and the curated
 * emoji list beside it.
 *
 * ## Why an explicit map and not `lucide-react`'s `icons` barrel
 *
 * `lucide-react` exports an `icons` object holding all 1,848 icons. A
 * single reference to it defeats tree-shaking and pulls the whole
 * catalog into the bundle. Every icon here is therefore a NAMED import,
 * so the bundler keeps exactly the ones listed and nothing else.
 *
 * ## This map IS the validity answer
 *
 * A279's degradation rule turns on "does this string match a known
 * Lucide catalog name?". That question is answered by `lucideIcon()`
 * looking in this map — never by a regex over the string's shape. A
 * hand-rolled "does this look like an icon id" test is the bug class
 * K103 hit three times; the catalog is the authority.
 *
 * ## The six legacy ids
 *
 * The pre-K104 picker offered 35 hand-rolled `ui/Icon.tsx` names. 29 of
 * them are also Lucide ids (`flag`, `star`, `link`, `ban`, …) so they
 * carry over untouched — an existing `icon: flag` on disk keeps
 * rendering and keeps being offered. Six are NOT Lucide ids (`alert`,
 * `subtasks`, `unarchive`, `refresh`, `list-numbered`, `code-block`).
 * Rather than orphan values already written to config, those six keys
 * stay in the map pointing at their nearest Lucide glyph. They are
 * marked `legacy` so the grid can rank them below the native ids, but
 * they remain selectable and renderable: dropping them would turn a
 * stored `icon: alert` into inert text, which is a silent visual
 * regression on existing trackers, not degradation of a bad value.
 *
 * ## Storage is unchanged
 *
 * What is stored is still a bare `string` (`IconStringSchema`). An id in
 * this map renders as that Lucide glyph; anything else — an emoji, a
 * typo, a name from another set — renders verbatim as text and is never
 * rewritten.
 */

/** One entry in the pickable Lucide catalog. */
export interface LucideCatalogEntry {
  /** The id stored on disk, and the id the grid addresses by testid. */
  readonly id: string;
  /** The component that draws it. */
  readonly Comp: LucideIcon;
  /** Extra search terms beyond the id's own words. */
  readonly keywords?: readonly string[];
  /** A pre-K104 hand-rolled name kept selectable; ranked last. */
  readonly legacy?: true;
}

function e(
  id: string,
  Comp: LucideIcon,
  keywords?: readonly string[],
): LucideCatalogEntry {
  return keywords === undefined ? { id, Comp } : { id, Comp, keywords };
}

/**
 * The pickable Lucide set, in presentation order (roughly: status and
 * workflow marks first, then people, then objects, then shapes).
 */
export const LUCIDE_CATALOG: readonly LucideCatalogEntry[] = [
  // Status / workflow
  e("flag", Flag), e("star", Star), e("check", Check, ["done", "tick"]),
  e("circle-check", CircleCheck, ["done", "complete"]),
  e("circle-x", CircleX, ["cancel", "reject"]),
  e("circle-alert", CircleAlert, ["warning", "error"]),
  e("triangle-alert", TriangleAlert, ["warning", "alert", "caution"]),
  e("ban", Ban, ["blocked", "forbidden"]),
  e("circle-help", CircleHelp, ["question", "unknown"]),
  e("info", Info), e("clock", Clock, ["time", "pending"]),
  e("timer", Timer), e("hourglass", Hourglass, ["waiting"]),
  e("play", Play, ["start"]), e("pause", Pause), e("circle-play", CirclePlay),
  e("circle-stop", CircleStop, ["stop"]),
  e("bug", Bug, ["defect", "issue"]), e("zap", Zap, ["fast", "urgent"]),
  e("flame", Flame, ["hot", "urgent"]), e("snowflake", Snowflake, ["frozen", "cold"]),
  e("rocket", Rocket, ["launch", "ship", "release"]),
  e("target", Target, ["goal", "milestone"]),
  e("sparkles", Sparkles, ["new", "magic"]),
  e("trending-up", TrendingUp), e("trending-down", TrendingDown),
  e("activity", Activity, ["pulse"]),
  e("award", Award), e("trophy", Trophy, ["win"]),
  e("thumbs-up", ThumbsUp), e("thumbs-down", ThumbsDown),
  e("heart", Heart, ["love", "favourite"]),
  e("bookmark", Bookmark, ["save"]), e("pin", Pin),
  e("tag", Tag, ["label"]), e("tags", Tags),

  // People
  e("user", User, ["person"]), e("users", Users, ["team", "group"]),
  e("users-round", UsersRound), e("user-plus", UserPlus, ["assign"]),
  e("user-check", UserCheck), e("user-x", UserX, ["unassign"]),
  e("at-sign", AtSign, ["mention"]), e("id-card", IdCard),
  e("handshake", Handshake, ["agreement"]), e("heart-handshake", HeartHandshake),
  e("smile", Smile, ["happy"]), e("meh", Meh), e("frown", Frown, ["sad"]),
  e("skull", Skull, ["dead"]), e("ghost", Ghost), e("bot", Bot, ["agent", "ai"]),
  e("brain", Brain, ["think"]),

  // Communication
  e("mail", Mail, ["email"]), e("inbox", Inbox), e("send", Send),
  e("reply", Reply), e("forward", Forward),
  e("message-square", MessageSquare, ["comment", "chat"]),
  e("bell", Bell, ["notify", "reminder"]), e("megaphone", Megaphone, ["announce"]),
  e("siren", Siren, ["incident", "alarm"]), e("radio", Radio),
  e("phone", Phone, ["call"]), e("mic", Mic, ["record"]),

  // Files / data
  e("file-text", FileText, ["document", "doc"]), e("folder", Folder),
  e("clipboard", Clipboard), e("clipboard-list", ClipboardList, ["checklist"]),
  e("newspaper", Newspaper, ["news"]), e("book-open", BookOpen, ["docs", "read"]),
  e("archive", Archive), e("package", Package, ["box", "release"]),
  e("database", Database, ["data"]), e("server", Server), e("cloud", Cloud),
  e("hard-drive", HardDrive, ["disk"]), e("cpu", Cpu), e("save", Save),
  e("upload", Upload), e("download", Download), e("copy", Copy),
  e("trash-2", Trash2, ["delete", "bin"]),

  // Dev
  e("git-branch", GitBranch, ["branch"]), e("git-merge", GitMerge, ["merge"]),
  e("git-pull-request", GitPullRequest, ["pr", "review"]),
  e("code", Code), e("braces", Braces, ["json"]), e("terminal", Terminal, ["cli", "shell"]),
  e("wrench", Wrench, ["fix", "tool"]), e("hammer", Hammer, ["build"]),
  e("settings", Settings, ["config", "gear"]), e("power", Power), e("plug", Plug),
  e("battery", Battery), e("wifi", Wifi), e("shield", Shield, ["security"]),
  e("shield-check", ShieldCheck, ["secure", "verified"]),
  e("lock", Lock, ["private"]), e("unlock", Unlock), e("key", Key),
  e("fingerprint", Fingerprint, ["identity", "auth"]),

  // Views / layout
  e("list", List), e("list-ordered", ListOrdered, ["numbered"]),
  e("layout-grid", LayoutGrid, ["board"]), e("grid-3x3", Grid3x3, ["grid"]),
  e("columns-3", Columns3, ["kanban", "board"]), e("rows-3", Rows3, ["table"]),
  e("layers", Layers, ["stack"]), e("filter", Filter, ["view", "query"]),
  e("search", Search, ["find"]), e("eye", Eye, ["visible", "watch"]),
  e("eye-off", EyeOff, ["hidden"]),
  e("chart-bar", ChartBar, ["graph", "report"]),
  e("chart-line", ChartLine, ["graph", "trend"]),
  e("chart-pie", ChartPie, ["graph"]),
  e("calendar", Calendar, ["date", "schedule"]),
  e("calendar-days", CalendarDays, ["sprint", "timeline"]),
  e("maximize", Maximize, ["expand"]), e("minimize", Minimize, ["collapse"]),
  e("move", Move, ["drag"]),

  // Arrows / structure
  e("arrow-up", ArrowUp), e("arrow-down", ArrowDown),
  e("arrow-left", ArrowLeft), e("arrow-right", ArrowRight),
  e("chevron-right", ChevronRight), e("corner-down-right", CornerDownRight, ["subtask", "child"]),
  e("repeat", Repeat, ["recurring", "loop"]), e("shuffle", Shuffle, ["random"]),
  e("undo-2", Undo2, ["revert"]), e("redo-2", Redo2),
  e("refresh-cw", RefreshCw, ["reload", "sync", "refresh"]),
  e("share-2", Share2, ["share"]), e("external-link", ExternalLink),
  e("link", Link, ["relation"]), e("link-2", Link2), e("unlink", Unlink),
  e("plus", Plus, ["add", "new"]), e("minus", Minus), e("x", X, ["close"]),

  // Text / editing
  e("bold", Bold), e("italic", Italic), e("quote", Quote),
  e("type", Type, ["text", "font"]), e("align-left", AlignLeft),
  e("pencil", Pencil, ["edit", "write"]), e("eraser", Eraser),
  e("highlighter", Highlighter), e("paperclip", Paperclip, ["attachment"]),
  e("scissors", Scissors, ["cut"]), e("signature", Signature), e("stamp", Stamp),
  e("pen-tool", PenTool, ["design"]), e("brush", Brush), e("palette", Palette),
  e("paint-bucket", PaintBucket), e("ruler", Ruler, ["measure", "estimate"]),

  // Business
  e("briefcase", Briefcase, ["work", "project"]),
  e("building", Building, ["company", "office"]),
  e("dollar-sign", DollarSign, ["money", "cost"]),
  e("credit-card", CreditCard, ["billing"]),
  e("shopping-cart", ShoppingCart), e("percent", Percent),
  e("scale", Scale, ["balance", "legal"]), e("gavel", Gavel, ["decision", "legal"]),
  e("life-buoy", LifeBuoy, ["support", "help"]),
  e("graduation-cap", GraduationCap, ["learning", "training"]),
  e("microscope", Microscope, ["research"]),
  e("flask-conical", FlaskConical, ["experiment", "lab"]),
  e("beaker", Beaker, ["test"]), e("atom", Atom, ["science"]),
  e("lightbulb", Lightbulb, ["idea", "feature"]),

  // World / misc
  e("globe", Globe, ["world", "public"]), e("map", MapIcon), e("map-pin", MapPin, ["location"]),
  e("compass", Compass, ["direction"]), e("mountain", Mountain), e("waves", Waves),
  e("leaf", Leaf, ["green"]), e("tree-pine", TreePine), e("droplet", Droplet),
  e("sun", Sun, ["light", "day"]), e("moon", Moon, ["dark", "night"]),
  e("sunrise", Sunrise), e("sunset", Sunset), e("cloud-rain", CloudRain),
  e("wind", Wind), e("monitor", Monitor, ["screen", "system"]),
  e("laptop", Laptop), e("smartphone", Smartphone, ["mobile"]),
  e("printer", Printer), e("camera", Camera), e("image", Image, ["photo"]),
  e("video", Video), e("music", Music), e("anchor", Anchor), e("ship", Ship),
  e("plane", Plane, ["travel"]), e("car", Car), e("bike", Bike),
  e("truck", Truck, ["delivery"]), e("footprints", Footprints, ["steps"]),
  e("dumbbell", Dumbbell, ["gym"]), e("coffee", Coffee, ["break"]),
  e("apple", Apple), e("pizza", Pizza), e("utensils", Utensils, ["food"]),
  e("wine", Wine), e("gift", Gift, ["reward"]),

  // Shapes
  e("circle", Circle), e("circle-dot", CircleDot), e("square", Square),
  e("triangle", Triangle), e("diamond", Diamond), e("hexagon", Hexagon),
  e("octagon", Octagon), e("asterisk", Asterisk), e("hash", Hash, ["tag", "number"]),
  e("infinity", InfinityIcon, ["endless"]),

  // The six pre-K104 hand-rolled names that are NOT Lucide ids. Kept
  // selectable and renderable so config already holding them does not
  // silently degrade to text. See the module doc.
  { id: "alert", Comp: TriangleAlert, keywords: ["warning", "caution"], legacy: true },
  { id: "subtasks", Comp: CornerDownRight, keywords: ["child", "nested"], legacy: true },
  { id: "unarchive", Comp: Archive, keywords: ["restore"], legacy: true },
  { id: "refresh", Comp: RefreshCw, keywords: ["reload", "sync"], legacy: true },
  { id: "list-numbered", Comp: ListOrdered, keywords: ["ordered"], legacy: true },
  { id: "code-block", Comp: CodeBlock, keywords: ["pre"], legacy: true },
];

/** Id → entry, built once. The authoritative "is this a Lucide id" map. */
const BY_ID: ReadonlyMap<string, LucideCatalogEntry> = new Map(
  LUCIDE_CATALOG.map(entry => [entry.id, entry]),
);

/**
 * The component for a stored icon string, or `undefined` when the string
 * is not a catalog id.
 *
 * `undefined` is the signal every caller treats as "render this
 * verbatim" — the field-local degradation A279 specifies.
 */
export function lucideIcon(icon: string | undefined): LucideIcon | undefined {
  if (icon === undefined) return undefined;
  return BY_ID.get(icon)?.Comp;
}

/** Whether a stored string names an icon this app can draw. */
export function isLucideIcon(icon: string | undefined): boolean {
  return lucideIcon(icon) !== undefined;
}

/** A human-readable label for a catalog id (`circle-check` → `Circle check`). */
export function lucideLabel(id: string): string {
  const spaced = id.replace(/-/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * The curated common-emoji list (K104's source 2).
 *
 * Originally a deliberately short, scannable palette — "not a full
 * Unicode browser, which is what the free-type field below the tabs
 * exists for." Ken overruled that framing (2026-09-22): the picker's
 * Emoji tab "definitely" needed more than ~90 entries, so the list was
 * expanded to a few hundred. The free-type field still exists for
 * anything not covered here, but "deliberately short" no longer
 * describes this list — it now aims for broad tracker-relevant coverage
 * while still excluding anything that turns to mush at 16px (dense
 * scenes, multi-person ZWJ sequences) and skin-tone/gender variants
 * (one neutral form per concept, to keep the list and its keyword
 * matching from multiplying without adding meaning). Each entry still
 * carries search keywords because an emoji has no name to match on.
 */
export interface EmojiCatalogEntry {
  readonly char: string;
  readonly keywords: readonly string[];
}

function m(char: string, ...keywords: string[]): EmojiCatalogEntry {
  return { char, keywords };
}

export const EMOJI_CATALOG: readonly EmojiCatalogEntry[] = [
  m("✅", "check", "done", "complete", "tick"),
  m("❌", "cross", "fail", "no", "cancel"),
  m("⚠️", "warning", "alert", "caution"),
  m("🚧", "construction", "wip", "blocked"),
  m("🔥", "fire", "hot", "urgent"),
  m("⭐", "star", "favourite", "important"),
  m("🌟", "star", "glowing", "new"),
  m("💡", "idea", "lightbulb", "feature"),
  m("🐛", "bug", "defect", "issue"),
  m("🔧", "wrench", "fix", "tool"),
  m("🔨", "hammer", "build"),
  m("🚀", "rocket", "launch", "ship", "release"),
  m("🎯", "target", "goal", "milestone"),
  m("📌", "pin", "pinned"),
  m("📍", "location", "marker"),
  m("🏁", "flag", "finish", "done"),
  m("🚩", "flag", "red", "risk"),
  m("🏷️", "label", "tag"),
  m("📋", "clipboard", "list", "task"),
  m("📝", "memo", "note", "write"),
  m("📄", "document", "page", "doc"),
  m("📁", "folder", "directory"),
  m("📦", "package", "box", "release"),
  m("🗂️", "dividers", "archive", "organise"),
  m("🗑️", "trash", "delete", "bin"),
  m("📊", "chart", "bar", "report"),
  m("📈", "chart", "up", "growth"),
  m("📉", "chart", "down", "decline"),
  m("🗓️", "calendar", "date", "schedule"),
  m("⏰", "alarm", "clock", "deadline"),
  m("⏳", "hourglass", "waiting", "pending"),
  m("⌛", "hourglass", "done", "timeout"),
  m("🔁", "repeat", "recurring", "loop"),
  m("🔍", "search", "find", "magnifier"),
  m("🔒", "lock", "private", "secure"),
  m("🔓", "unlock", "open", "public"),
  m("🔑", "key", "access", "auth"),
  m("🛡️", "shield", "security", "protect"),
  m("⚡", "zap", "fast", "energy"),
  m("💥", "boom", "crash", "incident"),
  m("🧊", "ice", "frozen", "cold"),
  m("❄️", "snowflake", "freeze", "cold"),
  m("🌱", "seedling", "new", "growth"),
  m("🌳", "tree", "green"),
  m("🧪", "test", "experiment", "lab"),
  m("🔬", "microscope", "research"),
  m("🧠", "brain", "think", "design"),
  m("🤖", "robot", "bot", "agent", "ai"),
  m("👤", "person", "user", "assignee"),
  m("👥", "people", "team", "group"),
  m("🙋", "raise", "hand", "volunteer", "ask"),
  m("💬", "speech", "comment", "chat"),
  m("📣", "megaphone", "announce"),
  m("📧", "email", "mail"),
  m("📞", "phone", "call"),
  m("🔔", "bell", "notify", "reminder"),
  m("👍", "thumbs", "up", "approve", "yes"),
  m("👎", "thumbs", "down", "reject", "no"),
  m("🎉", "party", "celebrate", "shipped"),
  m("🏆", "trophy", "win", "award"),
  m("💰", "money", "cost", "budget"),
  m("💳", "card", "billing", "payment"),
  m("⚖️", "scale", "legal", "balance"),
  m("🧹", "broom", "cleanup", "chore"),
  m("♻️", "recycle", "refactor", "reuse"),
  m("🩹", "bandage", "patch", "hotfix"),
  m("🚑", "ambulance", "emergency", "hotfix"),
  m("🛑", "stop", "halt", "blocked"),
  m("🟢", "green", "circle", "ok", "healthy"),
  m("🟡", "yellow", "circle", "warning"),
  m("🔴", "red", "circle", "critical"),
  m("🔵", "blue", "circle", "info"),
  m("⚫", "black", "circle", "inactive"),
  m("⚪", "white", "circle", "empty"),
  m("☀️", "sun", "light", "day"),
  m("🌙", "moon", "dark", "night"),
  m("🌍", "globe", "world", "public"),
  m("✈️", "plane", "travel"),
  m("☕", "coffee", "break"),
  m("🎨", "art", "palette", "design"),
  m("🎵", "music", "note"),
  m("📷", "camera", "photo"),
  m("🖥️", "monitor", "desktop", "system"),
  m("📱", "phone", "mobile"),
  m("💾", "floppy", "save", "storage"),
  m("🖇️", "clip", "attachment", "link"),
  m("🔗", "link", "chain", "relation"),
  m("♾️", "infinity", "endless"),
  m("❓", "question", "unknown", "help"),
  m("❗", "exclamation", "important"),
  m("💤", "sleep", "idle", "paused"),

  // — Status / workflow —
  m("✔️", "check", "done", "tick", "confirm"),
  m("☑️", "check", "box", "done", "checklist"),
  m("✳️", "asterisk", "new", "note"),
  m("🆕", "new", "fresh", "badge"),
  m("🆗", "ok", "approved", "badge"),
  m("🆙", "up", "upgrade", "badge"),
  m("🔃", "sync", "refresh", "reload"),
  m("🔄", "sync", "refresh", "cycle", "loop"),
  m("⏸️", "pause", "hold", "wait"),
  m("▶️", "play", "start", "resume"),
  m("⏹️", "stop", "halt"),
  m("⏭️", "next", "skip", "forward"),
  m("⏮️", "previous", "back", "rewind"),
  m("🔀", "shuffle", "random"),
  m("🔼", "up", "increase", "raise"),
  m("🔽", "down", "decrease", "lower"),
  m("📶", "signal", "bars", "progress"),
  m("🚦", "traffic", "light", "status", "gate"),
  m("🎚️", "slider", "level", "adjust"),
  m("🎛️", "dials", "control", "settings"),

  // — Priority / severity —
  m("🔺", "triangle", "up", "high", "priority"),
  m("🔻", "triangle", "down", "low", "priority"),
  m("‼️", "double", "exclamation", "urgent", "critical"),
  m("⁉️", "exclamation", "question", "surprise"),
  m("🚨", "siren", "alert", "incident", "urgent"),
  m("🔶", "orange", "diamond", "medium", "priority"),
  m("🔷", "blue", "diamond", "low", "priority"),
  m("🟠", "orange", "circle", "warning", "medium"),
  m("🟣", "purple", "circle", "status"),
  m("🟤", "brown", "circle", "status"),
  m("🟥", "red", "square", "critical", "blocked"),
  m("🟩", "green", "square", "ok", "done"),
  m("🟨", "yellow", "square", "warning"),
  m("🟦", "blue", "square", "info"),

  // — Time —
  m("🕐", "clock", "time", "hour"),
  m("📅", "calendar", "date", "schedule"),
  m("📆", "calendar", "tear-off", "date"),
  m("🗒️", "notepad", "note", "memo"),
  m("⏱️", "stopwatch", "timer", "measure"),
  m("⏲️", "timer", "countdown"),
  m("🕰️", "clock", "mantel", "history"),
  m("🕓", "clock", "four", "time"),

  // — People / roles —
  m("🧑", "person", "user", "adult"),
  m("🧑‍💼", "office", "worker", "manager"),
  m("🧑‍💻", "developer", "engineer", "coder"),
  m("🧑‍🔧", "mechanic", "technician", "fix"),
  m("🧑‍🎨", "artist", "designer", "creative"),
  m("🧑‍🏫", "teacher", "trainer", "instructor"),
  m("🧑‍🔬", "scientist", "researcher", "lab"),
  m("🧑‍⚖️", "judge", "legal", "decision"),
  m("🧑‍🚀", "astronaut", "space", "explorer"),
  m("🕵️", "detective", "investigate", "spy"),
  m("🧙", "wizard", "magic", "expert"),
  m("🫡", "salute", "respect", "acknowledge"),
  m("🤝", "handshake", "deal", "agreement"),
  m("🙏", "thanks", "please", "pray"),
  m("👋", "wave", "hello", "greet"),
  m("👏", "clap", "applause", "praise"),
  m("🙌", "hooray", "celebrate", "raised"),
  m("💪", "strong", "effort", "muscle"),
  m("🧑‍🤝‍🧑", "pair", "people", "collaboration"),
  m("👶", "baby", "new", "starter"),

  // — Emotion / reaction —
  m("😀", "happy", "smile", "grin"),
  m("😂", "laugh", "funny", "lol"),
  m("😅", "relief", "phew", "close-call"),
  m("😉", "wink", "joke"),
  m("😎", "cool", "confident"),
  m("😍", "love", "adore"),
  m("🤔", "thinking", "consider", "hmm"),
  m("🤨", "skeptical", "doubt", "suspicious"),
  m("😐", "neutral", "meh"),
  m("😴", "sleep", "tired", "asleep"),
  m("🥱", "yawn", "bored", "tired"),
  m("😱", "shock", "scream", "surprise"),
  m("😭", "cry", "sad", "upset"),
  m("😡", "angry", "mad", "furious"),
  m("🥳", "party", "celebrate", "happy"),
  m("🤯", "mind-blown", "shocked", "wow"),
  m("😬", "cringe", "awkward", "nervous"),
  m("🫠", "melting", "overwhelmed", "stress"),
  m("🥲", "bittersweet", "grateful", "smile-tear"),
  m("🤗", "hug", "welcome", "support"),

  // — Communication —
  m("💭", "thought", "bubble", "idea"),
  m("🗨️", "speech", "bubble", "comment"),
  m("📢", "announcement", "loudspeaker", "broadcast"),
  m("📮", "mailbox", "post", "send"),
  m("📨", "envelope", "incoming", "mail"),
  m("📩", "envelope", "arrow", "sent"),
  m("💌", "love-letter", "message"),
  m("🔕", "mute", "silent", "no-notify"),
  m("📡", "antenna", "broadcast", "signal"),

  // — Files / data —
  m("🗃️", "card", "file-box", "index"),
  m("🗄️", "cabinet", "storage", "archive"),
  m("📇", "index", "card", "rolodex"),
  m("📚", "books", "library", "docs"),
  m("📖", "book", "read", "manual"),
  m("📰", "newspaper", "news", "article"),
  m("🧾", "receipt", "invoice", "record"),
  m("📃", "page", "curl", "document"),
  m("📑", "bookmark", "tabs", "sections"),
  m("🗞️", "newspaper", "rolled", "news"),
  m("🔖", "bookmark", "save", "reference"),
  m("💽", "disk", "storage", "save"),
  m("💿", "cd", "disk", "media"),
  m("📀", "dvd", "disk", "media"),
  m("🧮", "abacus", "calculate", "count"),

  // — Dev / tech —
  m("💻", "laptop", "computer", "code"),
  m("⌨️", "keyboard", "type", "input"),
  m("🖱️", "mouse", "click", "pointer"),
  m("🧰", "toolbox", "tools", "kit"),
  m("🪛", "screwdriver", "fix", "tool"),
  m("🔩", "bolt", "nut", "hardware"),
  m("⚙️", "gear", "settings", "config"),
  m("🧲", "magnet", "attract", "pull"),
  m("🔌", "plug", "power", "connect"),
  m("🪫", "battery", "low", "depleted"),
  m("📟", "pager", "device", "beeper"),
  m("🛰️", "satellite", "network", "orbit"),
  m("🕸️", "web", "network", "spider"),
  m("🧬", "dna", "genetics", "structure"),
  m("🔎", "magnify", "search", "inspect"),

  // — Views / structure —
  m("📐", "ruler", "triangle", "measure", "plan"),
  m("📏", "ruler", "straight", "measure"),
  m("🧩", "puzzle", "piece", "component"),
  m("🪜", "ladder", "steps", "progress"),
  m("🪝", "hook", "attach"),
  m("🧭", "compass", "direction", "navigate"),
  m("🗺️", "map", "plan", "roadmap"),

  // — Arrows / structure —
  m("➡️", "arrow", "right", "next"),
  m("⬅️", "arrow", "left", "back"),
  m("⬆️", "arrow", "up", "increase"),
  m("⬇️", "arrow", "down", "decrease"),
  m("↗️", "arrow", "diagonal", "up-right", "growth"),
  m("↘️", "arrow", "diagonal", "down-right", "decline"),
  m("↩️", "arrow", "back", "undo", "reply"),
  m("↪️", "arrow", "forward", "redo"),
  m("🕹️", "joystick", "control", "manual"),
  m("🔂", "repeat", "once", "loop"),

  // — Numbers —
  m("0️⃣", "zero", "number"),
  m("1️⃣", "one", "number", "first"),
  m("2️⃣", "two", "number", "second"),
  m("3️⃣", "three", "number", "third"),
  m("4️⃣", "four", "number"),
  m("5️⃣", "five", "number"),
  m("#️⃣", "hash", "number", "pound"),
  m("🔟", "ten", "number"),
  m("🔢", "numbers", "count", "digits"),
  m("💯", "hundred", "perfect", "complete"),

  // — Business / money —
  m("💵", "cash", "dollar", "money"),
  m("💸", "money", "spend", "cost", "flying"),
  m("🧑‍💰", "budget", "money", "finance"),
  m("🏦", "bank", "finance", "institution"),
  m("💹", "revenue", "growth", "quarter"),
  m("🧑‍🎓", "graduate", "learning", "certified"),
  m("🎓", "graduation", "cap", "education"),
  m("🏢", "building", "office", "company"),
  m("🏭", "factory", "production", "plant"),
  m("🏗️", "construction", "crane", "building"),
  m("🧑‍🌾", "farmer", "agriculture"),
  m("🛒", "cart", "shopping", "order"),
  m("🎁", "gift", "reward", "bonus"),
  m("🏅", "medal", "award", "achievement"),
  m("🥇", "gold", "first", "winner"),

  // — World / nature —
  m("🌎", "earth", "world", "global"),
  m("🌐", "globe", "network", "web"),
  m("🗻", "mountain", "fuji", "peak"),
  m("🏔️", "mountain", "snow", "peak"),
  m("🏝️", "island", "beach", "tropical"),
  m("🏜️", "desert", "dry"),
  m("🌊", "wave", "ocean", "sea"),
  m("🌦️", "weather", "sun", "rain"),
  m("⛈️", "storm", "thunder", "weather"),
  m("🌈", "rainbow", "colour", "spectrum"),
  m("🌪️", "tornado", "storm", "chaos"),
  m("🌵", "cactus", "desert", "plant"),
  m("🍀", "clover", "luck", "green"),
  m("🌸", "blossom", "flower", "spring"),
  m("🍁", "leaf", "autumn", "fall"),
  m("🌻", "sunflower", "flower", "bright"),
  m("🦋", "butterfly", "transform", "change"),
  m("🐝", "bee", "busy", "productive"),
  m("🐢", "turtle", "slow", "steady"),
  m("🐇", "rabbit", "fast", "quick"),
  m("🦉", "owl", "wise", "night"),
  m("🐙", "octopus", "multitask", "many-arms"),

  // — Objects / places —
  m("🏠", "house", "home"),
  m("🏫", "school", "building", "education"),
  m("🏥", "hospital", "medical", "health"),
  m("🏪", "store", "shop"),
  m("🏛️", "institution", "government", "bank"),
  m("🚪", "door", "entry", "exit"),
  m("🪟", "window", "view"),
  m("🛋️", "sofa", "lounge", "rest"),
  m("🛏️", "bed", "sleep"),
  m("🧳", "luggage", "travel", "pack"),
  m("🎒", "backpack", "school", "carry"),
  m("👜", "bag", "carry"),
  m("🕶️", "sunglasses", "cool", "hidden"),
  m("👓", "glasses", "read", "vision"),
  m("🎧", "headphones", "audio", "listen"),
  m("📺", "tv", "screen", "broadcast"),
  m("🔋", "battery", "power", "charge"),
  m("🔦", "flashlight", "torch", "light"),
  m("🕯️", "candle", "light", "flame"),
  m("🧯", "extinguisher", "fire", "safety"),
  m("🩺", "stethoscope", "medical", "health", "check"),
  m("💊", "pill", "medicine", "fix"),

  // — Transport —
  m("🚗", "car", "drive", "vehicle"),
  m("🚌", "bus", "transport"),
  m("🚆", "train", "rail", "transport"),
  m("🚁", "helicopter", "air", "transport"),
  m("🛴", "scooter", "transport"),
  m("🛵", "moped", "delivery"),
  m("⛵", "sailboat", "ship", "travel"),
  m("🚢", "ship", "boat", "cargo"),
  m("🛸", "ufo", "unknown", "future"),

  // — Food / break —
  m("🍕", "pizza", "food", "lunch"),
  m("🍔", "burger", "food", "lunch"),
  m("🍎", "apple", "fruit", "health"),
  m("🍫", "chocolate", "snack", "treat"),
  m("🍩", "donut", "snack", "treat"),
  m("🍪", "cookie", "snack"),
  m("🍺", "beer", "drink", "social"),
  m("🍷", "wine", "drink", "social"),
  m("🍵", "tea", "drink", "break"),
  m("🥤", "drink", "cup", "beverage"),

  // — Symbols —
  m("✨", "sparkle", "new", "polish", "shiny"),
  m("💫", "dizzy", "sparkle", "special"),
  m("🔆", "bright", "brightness", "highlight"),
  m("🔅", "dim", "low", "brightness"),
  m("🔯", "star", "symbol", "protection"),
  m("🕉️", "symbol", "om", "spiritual"),
  m("☮️", "peace", "symbol"),
  m("🌀", "cycle", "spiral", "loop"),
  m("⚛️", "atom", "science", "physics"),
  m("🔱", "trident", "symbol", "power"),
  m("🎗️", "ribbon", "awareness", "campaign"),
  m("🏳️", "flag", "white", "surrender", "truce"),
  m("🏴", "flag", "black", "signal"),
  m("🔰", "beginner", "novice", "new"),
  m("⭕", "circle", "correct", "mark"),
  m("💠", "diamond", "shape", "gem"),
  m("🔘", "radio", "button", "option"),
  m("🧿", "amulet", "protection", "evil-eye"),
  m("🪄", "wand", "magic", "automate"),
];
