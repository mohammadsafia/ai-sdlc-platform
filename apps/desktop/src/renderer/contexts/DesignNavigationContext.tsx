// apps/desktop/src/renderer/contexts/DesignNavigationContext.tsx
import { createContext, useContext, type ReactNode } from 'react';

export type DesignNavigate = (brdSlug: string, requirementId: string) => void;

const DesignNavigationContext = createContext<DesignNavigate | null>(null);

export function DesignNavigationProvider({ navigate, children }: { navigate: DesignNavigate; children: ReactNode }) {
  return <DesignNavigationContext.Provider value={navigate}>{children}</DesignNavigationContext.Provider>;
}

/** Opens the Design view on a requirement; null outside the provider (tests, isolated renders). */
export function useDesignNavigation(): DesignNavigate | null {
  return useContext(DesignNavigationContext);
}
