import type { Meta, StoryObj } from "@storybook/react-vite";
import { BookOpen, Camera, LayoutGrid } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../ui";
import { camButtonSm, camChip, ThreeUp } from "../features/snaps/parts";

/**
 * Three ways to make Recipes easy to find from the Snap home. Mock layouts (no camera, no API),
 * all at the same width, so only the Recipes entry point differs.
 */
function Phone({ children, bottom }: { children: ReactNode; bottom?: ReactNode }) {
  return (
    <div className="mx-auto flex h-[640px] w-[360px] flex-col bg-cam px-4 pt-3.5 pb-5 text-cam-ink">
      {children}
      <div className="flex flex-1 items-center justify-center">
        <div className="grid size-22 place-items-center rounded-full border-4 border-cam-accent" aria-label="Shutter">
          <Camera className="size-7" aria-hidden />
        </div>
      </div>
      {bottom}
    </div>
  );
}

const avatar = <span className="grid size-11 place-items-center rounded-full bg-cam-accent font-semibold text-cam-accent-ink">A</span>;
const friends = <span className={camChip}>3 friends</span>;
const feedBtn = (
  <span className={camButtonSm}>
    <LayoutGrid className="size-5" aria-hidden />
  </span>
);
const recipesBtn = (
  <span className={camButtonSm}>
    <BookOpen className="size-5" aria-hidden />
  </span>
);

const meta = { title: "Mockups/113 Recipes entry/Snap home", parameters: { layout: "centered" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const OptionALabelledChipBottomLeft: Story = {
  name: "Option A Labelled chip, bottom-left (implemented)",
  render: () => (
    <Phone
      bottom={
        <ThreeUp
          className="px-3"
          left={
            <span className={cn(camChip, "min-h-12")}>
              <BookOpen className="size-4" aria-hidden />
              Recipes
            </span>
          }
          center={<span className="text-xs">Feed handle</span>}
        />
      }
    >
      <ThreeUp className="h-12" left={avatar} center={friends} right={feedBtn} />
    </Phone>
  ),
};

export const OptionBIconNextToFeed: Story = {
  name: "Option B Icon next to Feed, top-right",
  render: () => (
    <Phone bottom={<ThreeUp className="px-3" center={<span className="text-xs">Feed handle</span>} />}>
      <ThreeUp
        className="h-12"
        left={avatar}
        center={friends}
        right={
          <div className="flex gap-2">
            {recipesBtn}
            {feedBtn}
          </div>
        }
      />
    </Phone>
  ),
};

export const OptionCBottomTabBar: Story = {
  name: "Option C Bottom bar: Recipes, Snap, Feed",
  render: () => (
    <Phone
      bottom={
        <nav aria-label="Main" className="grid grid-cols-3 gap-2 text-xs font-semibold">
          {[
            [BookOpen, "Recipes"],
            [Camera, "Snap"],
            [LayoutGrid, "Feed"],
          ].map(([Icon, label]) => {
            const I = Icon as typeof BookOpen;
            return (
              <span key={label as string} className="flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl bg-cam-chip">
                <I className="size-5" aria-hidden />
                {label as string}
              </span>
            );
          })}
        </nav>
      }
    >
      <ThreeUp className="h-12" left={avatar} center={friends} />
    </Phone>
  ),
};
