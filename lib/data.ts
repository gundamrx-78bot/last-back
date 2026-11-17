import taxonomyJson from "@/data/taxonomy.json";
import coursesJson from "@/data/courses.json";
import eventsJson from "@/data/events.json";

export interface Taxon { code: string; name: string; label?: string; cause?: string; how?: string; first?: string; tips?: string[]; prompt?: string; next?: string }
export interface Course {
  id: string; title: string; org: string | null; mode: "online" | "offline" | "hybrid" | null; region: string | null;
  startAt: string | null; endAt: string | null; applyOpenAt: string | null; applyCloseAt: string | null;
  venueName?: string | null; venueAddress?: string | null; venueDetail?: string | null;
  cost: string | null; needsPaid: boolean; field: string | null; jobTags: string[]; levelFrom: number | null; levelTo: number | null;
  prerequisites: string | null; outcomes: string[]; difficulty: string | null; link?: string; source?: string;
  infoLevel?: string; status: string; scheduleNote?: string; updatedAt?: string;
}
export interface EventItem { date: string; kind: string; title: string; venue: string | null; time: string | null; link?: string }

export const TAX = taxonomyJson as unknown as {
  stuck: Taxon[]; job: Taxon[]; level: Taxon[]; paid: { code: string; label: string }[];
  jobExamples: Record<string, Record<string, string>>;
};
export const COURSES = (coursesJson as unknown as { courses: Course[]; checkedAt: string }).courses.filter((c) => c.status === "published");
export const COURSES_CHECKED_AT = (coursesJson as unknown as { checkedAt: string }).checkedAt;
export const EVENTS = (eventsJson as unknown as { items: EventItem[]; checkedAt: string }).items;
export const EVENTS_CHECKED_AT = (eventsJson as unknown as { checkedAt: string }).checkedAt;

export const byCode = (list: Taxon[]) => Object.fromEntries(list.map((x) => [x.code, x])) as Record<string, Taxon>;
export const STUCK = byCode(TAX.stuck);
export const JOB = byCode(TAX.job);
export const LEVEL = byCode(TAX.level);
