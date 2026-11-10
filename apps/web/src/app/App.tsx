import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { FeatureRoute } from "../features/features/Feature";
import { FeaturesProvider } from "../features/features/FeaturesProvider";
import { RequireAuth, SetupPage, SignInPage, SignUpPage } from "../features/auth/AuthPages";
import { AppShell } from "./AppShell";
import { Gallery } from "./pages/Gallery";
import { RecipeLibrary } from "../features/recipes/RecipeLibrary";
import { RecipePage } from "../features/recipes/RecipePage";
import { MorePage, PlanPage, RecipeEditPage, RecipeImportPage, RecipeNewPage, ShoppingPage } from "./pages/Placeholders";

const queryClient = new QueryClient();

export function AppRoutes() {
  return (
    <Routes>
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
              <ShoppingPage />
            </FeatureRoute>
          }
        />
        <Route path="/more" element={<MorePage />} />
        {import.meta.env.DEV && <Route path="/ui" element={<Gallery />} />}
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <FeaturesProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </FeaturesProvider>
    </QueryClientProvider>
  );
}
