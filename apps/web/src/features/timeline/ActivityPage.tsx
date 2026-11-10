import { EventList } from "./Timeline";

export function ActivityPage() {
  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-2xl font-semibold">Activity</h1>
      <EventList slug={null} empty="No activity yet. Cook something and log it." />
    </div>
  );
}
