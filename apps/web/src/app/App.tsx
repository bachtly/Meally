import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router";
import { FeaturesProvider } from "../features/features/FeaturesProvider";
import { HealthPage } from "../features/health/HealthPage";

const queryClient = new QueryClient();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <FeaturesProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HealthPage />} />
        </Routes>
      </BrowserRouter>
      </FeaturesProvider>
    </QueryClientProvider>
  );
}
