import { Inbox, Plus, Settings } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  Badge,
  Button,
  Card,
  Dialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  IconButton,
  Input,
  Sheet,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  ThemeToggle,
  useToast,
} from "../../ui";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="flex flex-wrap items-start gap-3">{children}</div>
    </section>
  );
}

/** Dev-only gallery of every component. Switch themes with the toggle. */
export function Gallery() {
  const toast = useToast();
  const [sheet, setSheet] = useState(false);
  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold">Component gallery</h1>
      <Section title="Theme">
        <ThemeToggle />
      </Section>
      <Section title="Buttons">
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Delete</Button>
        <Button size="sm">Small</Button>
        <Button size="lg">Large</Button>
        <Button loading>Saving</Button>
        <Button disabled>Disabled</Button>
        <IconButton aria-label="Settings">
          <Settings className="size-5" aria-hidden />
        </IconButton>
      </Section>
      <Section title="Fields">
        <div className="flex w-full max-w-sm flex-col gap-4">
          <Field label="Title" hint="Short and plain.">
            <Input placeholder="Pancakes" />
          </Field>
          <Field label="Servings" error="Enter a number.">
            <Input defaultValue="abc" />
          </Field>
          <Field label="Notes">
            <Textarea />
          </Field>
        </div>
      </Section>
      <Section title="Card and badges">
        <Card className="w-full max-w-xs p-4">
          <h3 className="font-semibold">Lemon pasta</h3>
          <p className="text-muted">20 min</p>
          <div className="mt-2 flex gap-2">
            <Badge>Vegetarian</Badge>
            <Badge tone="accent">New</Badge>
            <Badge tone="success">Done</Badge>
            <Badge tone="danger">Out</Badge>
          </div>
        </Card>
      </Section>
      <Section title="Loading and empty">
        <div className="flex w-full max-w-xs flex-col gap-2">
          <Skeleton className="h-32" />
          <Skeleton className="h-4 w-2/3" />
        </div>
        <EmptyState icon={<Inbox className="size-10" />} title="Nothing here" action={<Button size="sm">Add one</Button>}>
          Add your first item to get started.
        </EmptyState>
      </Section>
      <Section title="Overlays">
        <Dialog title="Delete recipe?" description="This cannot be undone." trigger={<Button variant="secondary">Dialog</Button>}>
          <Button variant="danger">Delete</Button>
        </Dialog>
        <Sheet open={sheet} onOpenChange={setSheet} title="Add recipe" trigger={<Button variant="secondary">Sheet</Button>}>
          <Field label="Name">
            <Input />
          </Field>
          <Button onClick={() => setSheet(false)}>Save</Button>
        </Sheet>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary">Menu</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>
              <Plus className="size-4" aria-hidden /> Add
            </DropdownMenuItem>
            <DropdownMenuItem>Rename</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="secondary" onClick={() => toast("Saved", "success")}>
          Toast
        </Button>
      </Section>
      <Section title="Tabs">
        <Tabs defaultValue="a" className="w-full max-w-sm">
          <TabsList>
            <TabsTrigger value="a">Ingredients</TabsTrigger>
            <TabsTrigger value="b">Steps</TabsTrigger>
          </TabsList>
          <TabsContent value="a" className="py-3">
            Flour, eggs, milk.
          </TabsContent>
          <TabsContent value="b" className="py-3">
            Mix and fry.
          </TabsContent>
        </Tabs>
      </Section>
    </div>
  );
}
