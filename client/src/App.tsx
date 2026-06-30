import { Switch, Route } from "wouter";
import ParcelogikPage from "./pages/ParcelIQ";

export default function App() {
  return (
    <Switch>
      <Route path="/" component={ParcelogikPage} />
      <Route path="/parcelogik" component={ParcelogikPage} />
      <Route path="/parceliq" component={ParcelogikPage} />
      <Route>
        <div className="flex items-center justify-center min-h-screen text-muted-foreground">
          Page not found.
        </div>
      </Route>
    </Switch>
  );
}
