import type { NavigateFunction } from "react-router-dom";

// react-router's navigate function is only available inside components via useNavigate().
// Notification click handlers fire outside the React tree, so RequireAuth (App.tsx)
// captures the current navigate function here for anything outside components to use.
export const navigationRef: { current: NavigateFunction | null } = { current: null };
