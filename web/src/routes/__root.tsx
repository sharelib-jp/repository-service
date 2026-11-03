import { createRootRoute, Outlet } from '@tanstack/react-router'

import HeaderComponent from '../components/Header/Header.tsx'
import { Sidebar } from '../components/Sidebar'
import { Authentication } from '../components/Authentication/Authentication'

import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'

export const Route = createRootRoute({
  component: () => (
    <Authentication>
      <div className="flex h-dvh flex-col overflow-hidden">
        <HeaderComponent />
        <Sidebar>
          <Outlet />
        </Sidebar>
        {import.meta.env.DEV && <TanStackRouterDevtools />}
      </div>
    </Authentication>
  ),
})
