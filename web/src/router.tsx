import { lazy } from "react"
import { createBrowserRouter } from "react-router"

import { AppLayout } from "@/components/layout/app-layout"
import { AuthGate } from "@/components/layout/auth-gate"
import { RouteError } from "@/components/layout/route-error"
import type { RouteHandle } from "@/components/layout/site-header"

const LoginPage = lazy(() => import("@/pages/login"))
const SetupPage = lazy(() => import("@/pages/setup"))
const DashboardPage = lazy(() => import("@/pages/dashboard"))
const AuthoritiesPage = lazy(() => import("@/pages/authorities"))
const AuthorityDetailPage = lazy(() => import("@/pages/authority-detail"))
const CertificatesPage = lazy(() => import("@/pages/certificates"))
const CertificateDetailPage = lazy(() => import("@/pages/certificate-detail"))
const InspectPage = lazy(() => import("@/pages/inspect"))
const SettingsPage = lazy(() => import("@/pages/settings"))
const TenantsPage = lazy(() => import("@/pages/tenants"))
const TenantDetailPage = lazy(() => import("@/pages/tenant-detail"))
const UsersPage = lazy(() => import("@/pages/users"))
const NotFoundPage = lazy(() => import("@/pages/not-found"))

const handle = (h: RouteHandle) => h

export const router = createBrowserRouter([
  {
    element: <AuthGate />,
    errorElement: <RouteError />,
    children: [
      { path: "setup", element: <SetupPage /> },
      { path: "login", element: <LoginPage /> },
      {
        element: <AppLayout />,
        errorElement: <RouteError />,
        children: [
          { index: true, element: <DashboardPage />, handle: handle({ section: "shell.nav.dashboard" }) },
          {
            path: "authorities",
            element: <AuthoritiesPage />,
            handle: handle({ section: "shell.nav.authorities" }),
          },
          {
            path: "authorities/:id",
            element: <AuthorityDetailPage />,
            handle: handle({ section: "shell.nav.authorities", sectionPath: "/authorities", recordKind: "ca" }),
          },
          {
            path: "certificates",
            element: <CertificatesPage />,
            handle: handle({ section: "shell.nav.certificates" }),
          },
          {
            path: "certificates/:id",
            element: <CertificateDetailPage />,
            handle: handle({ section: "shell.nav.certificates", sectionPath: "/certificates", recordKind: "leaf" }),
          },
          { path: "inspect", element: <InspectPage />, handle: handle({ section: "shell.nav.inspect" }) },
          { path: "settings/:tab?", element: <SettingsPage />, handle: handle({ section: "shell.nav.settings" }) },
          { path: "tenants", element: <TenantsPage />, handle: handle({ section: "shell.nav.tenants" }) },
          {
            path: "tenants/:id",
            element: <TenantDetailPage />,
            handle: handle({ section: "shell.nav.tenants", sectionPath: "/tenants", recordKind: "tenant" }),
          },
          { path: "users", element: <UsersPage />, handle: handle({ section: "shell.nav.users" }) },
          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
])
