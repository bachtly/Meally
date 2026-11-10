import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, createRoutesFromElements, Navigate, Route, RouterProvider } from "react-router";
import { FeatureRoute } from "../features/features/Feature";
import { FeaturesProvider } from "../features/features/FeaturesProvider";
import { RequireAuth, SetupPage, SignInPage, SignUpPage } from "../features/auth/AuthPages";
import { AppShell } from "./AppShell";
import { Gallery } from "./pages/Gallery";
import { RecipeLibrary } from "../features/recipes/RecipeLibrary";
import { RecipePage } from "../features/recipes/RecipePage";
import { RecipeEditPage, RecipeNewPage } from "../features/recipes/RecipeEditor";
import { RecipeImportPage } from "../features/import-url/ImportPage";
import { ShoppingListsPage } from "../features/shopping/ShoppingLists";
import { ShoppingListPage } from "../features/shopping/ShoppingListPage";
import { PlanPage } from "../features/meal-plan/PlanPage";
import { MorePage } from "./pages/Placeholders";

const queryClient = new QueryClient();
let router: ReturnType<typeof createBrowserRouter> | undefined;

/** Routes are data-router objects so the editor can use `useBlocker`. */
export const appRoutes = createRoutesFromElements(
  <>
      <Route path="/signin" element={<SignInPage />} />
      <Route path="/signup" element={<SignUpPage />} />
      <Route path="/setup" element={<SetupPage />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Navigate to="/recipes" replace />} />
        <Route path="/recipes" element={<RecipeLibrary />} />
        <Route path="/recipes/new" element={<RecipeNewPage />} />
        <Route
          path="/recipes/import"
          element={
            <FeatureRoute on="import-url">
              <RecipeImportPage />
            </FeatureRoute>
          }
        />
        <Route path="/recipes/:slug" element={<RecipePage />} />
        <Route path="/recipes/:slug/edit" element={<RecipeEditPage />} />
        <Route
          path="/plan"
          element={
            <FeatureRoute on="meal-plan">
              <PlanPage />
            </FeatureRoute>
          }
        />
        <Route
          path="/shopping"
          element={
            <FeatureRoute on="shopping-lists">
              <ShoppingListsPage />
            </FeatureRoute>
          }
        />
        <Route
          path="/shopping/:id"
          element={
            <FeatureRoute on="shopping-lists">
              <ShoppingListPage />
            </FeatureRoute>
          }
        />
        <Route path="/more" element={<MorePage />} />
        {import.meta.env.DEV && <Route path="/ui" element={<Gallery />} />}
      </Route>
  </>,
);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <FeaturesProvider>
        <RouterProvider router={(router ??= createBrowserRouter(appRoutes))} />
      </FeaturesProvider>
    </QueryClientProvider>
  );
}
