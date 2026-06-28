import { Switch, Route } from "wouter";
import ParcelIQPage from "./pages/ParcelIQ";

export default function App() {
  return (
    <Switch>
      <Route path="/" component={ParcelIQPage} />
      <Route path="/parceliq" component={ParcelIQPage} />
      <Route>
        <div className="flex items-center justify-center min-h-screen text-muted-foreground">
          Page not found.
        </div>
      </Route>
    </Switch>
  );
}
