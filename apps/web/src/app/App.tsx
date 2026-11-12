import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, createRoutesFromElements, Navigate, Outlet, Route, RouterProvider } from "react-router";
import { FeatureRoute } from "../features/features/Feature";
import { FeaturesProvider } from "../features/features/FeaturesProvider";
import { RequireAuth, SetupPage, SignInPage, SignUpPage } from "../features/auth/AuthPages";
import { PwaProvider } from "../pwa/Pwa";
import { AppShell } from "./AppShell";
import { Gallery } from "./pages/Gallery";
import { RecipeLibrary } from "../features/recipes/RecipeLibrary";
import { RecipePage } from "../features/recipes/RecipePage";
import { RecipeEditPage, RecipeNewPage } from "../features/recipes/RecipeEditor";
import { RecipeImportPage } from "../features/import-url/ImportPage";
import { ShoppingListsPage } from "../features/shopping/ShoppingLists";
import { ShoppingListPage } from "../features/shopping/ShoppingListPage";
import { PlanPage } from "../features/meal-plan/PlanPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { CookbookPage } from "../features/cookbooks/CookbookPage";
import { CookbooksPage } from "../features/cookbooks/CookbooksPage";
import { ImportFilesPage } from "../features/import-files/ImportFilesPage";
import { FoodsPage } from "../features/foods/FoodsPage";
import { OrganizersPage } from "../features/organizers/OrganizersPage";
import { PrintPage } from "../features/print/PrintPage";
import { CookPage } from "../features/cook-mode/CookPage";
import { SharePage, ShareLayout, ShareRecipePage } from "../features/share/SharePage";
import { AdminPage } from "../features/admin/AdminPage";
import { FriendsPage } from "../features/friends/FriendsPage";
import { InviteLayout, InvitePage } from "../features/friends/InvitePage";
import { MorePage } from "./pages/Placeholders";

// offlineFirst: fire requests even when navigator.onLine is false so offline pages fall back to the service worker cache.
const queryClient = new QueryClient({ defaultOptions: { queries: { networkMode: "offlineFirst" } } });
let router: ReturnType<typeof createBrowserRouter> | undefined;

/** Routes are data-router objects so the editor can use `useBlocker`. */
export const appRoutes = createRoutesFromElements(
  <>
      <Route path="/signin" element={<SignInPage />} />
      <Route path="/signup" element={<SignUpPage />} />
      <Route path="/sign-up" element={<SignUpPage />} />
      <Route path="/setup" element={<SetupPage />} />
      <Route element={<ShareLayout />}>
        <Route path="/s/:token" element={<SharePage />} />
        <Route path="/s/:token/:slug" element={<ShareRecipePage />} />
      </Route>
      <Route element={<InviteLayout />}>
        <Route path="/invite/:token" element={<InvitePage />} />
      </Route>
      <Route
        element={
          <RequireAuth>
            <Outlet />
          </RequireAuth>
        }
      >
        <Route
          path="/recipes/:slug/cook"
          element={
            <FeatureRoute on="cook-mode">
              <CookPage />
            </FeatureRoute>
          }
        />
        <Route
          path="/recipes/:slug/print"
          element={
            <FeatureRoute on="print">
              <PrintPage />
            </FeatureRoute>
          }
        />
      </Route>
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
        <Route
          path="/foods"
          element={
            <FeatureRoute on="foods-units">
              <FoodsPage />
            </FeatureRoute>
          }
        />
        <Route
          path="/organizers"
          element={
            <FeatureRoute on="organizers">
              <OrganizersPage />
            </FeatureRoute>
          }
        />
        <Route
          path="/cookbooks"
          element={
            <FeatureRoute on="cookbooks">
              <CookbooksPage />
            </FeatureRoute>
          }
        />
        <Route
          path="/cookbooks/:slug"
          element={
            <FeatureRoute on="cookbooks">
              <CookbookPage />
            </FeatureRoute>
          }
        />
        <Route
          path="/friends"
          element={
            <FeatureRoute on="friends">
              <FriendsPage />
            </FeatureRoute>
          }
        />
        <Route path="/more" element={<MorePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route
          path="/settings/import"
          element={
            <FeatureRoute on="import-files">
              <ImportFilesPage />
            </FeatureRoute>
          }
        />
        {import.meta.env.DEV && <Route path="/ui" element={<Gallery />} />}
      </Route>
  </>,
);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <FeaturesProvider>
        <PwaProvider>
          <RouterProvider router={(router ??= createBrowserRouter(appRoutes))} />
        </PwaProvider>
      </FeaturesProvider>
    </QueryClientProvider>
  );
}
