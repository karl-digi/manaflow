import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_layout/profile")({
  component: ProfileComponent,
});

function ProfileComponent() {
  return (
    <div className="flex flex-col grow overflow-auto">
      <div className="p-8 max-w-4xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
            Profile
          </h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Manage your personal information and preferences
          </p>
        </div>

        {/* Profile Sections */}
        <div className="space-y-6">
          {/* Personal Information */}
          <div className="bg-white dark:bg-neutral-950 rounded-lg border border-neutral-200 dark:border-neutral-800">
            <div className="px-6 py-4 border-b border-neutral-200 dark:border-neutral-800">
              <h2 className="text-base font-medium text-neutral-900 dark:text-neutral-100">
                Personal Information
              </h2>
            </div>
            <div className="p-6">
              <div className="flex items-start space-x-6 mb-6">
                <div className="relative">
                  <div className="w-24 h-24 bg-neutral-200 dark:bg-neutral-800 rounded-full flex items-center justify-center">
                    <span className="text-3xl text-neutral-500 dark:text-neutral-400">
                      JD
                    </span>
                  </div>
                  <button className="absolute bottom-0 right-0 bg-white dark:bg-neutral-900 rounded-full p-1.5 shadow-md border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-default">
                    <svg
                      className="w-4 h-4 text-neutral-600 dark:text-neutral-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                    </svg>
                  </button>
                </div>
                <div className="flex-1">
                  <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-1">
                    Your photo will be displayed across the workspace
                  </p>
                  <button className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 cursor-default">
                    Upload new photo
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label
                    htmlFor="first-name"
                    className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2"
                  >
                    First Name
                  </label>
                  <input
                    type="text"
                    id="first-name"
                    className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100"
                    defaultValue="John"
                  />
                </div>

                <div>
                  <label
                    htmlFor="last-name"
                    className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2"
                  >
                    Last Name
                  </label>
                  <input
                    type="text"
                    id="last-name"
                    className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100"
                    defaultValue="Doe"
                  />
                </div>

                <div>
                  <label
                    htmlFor="email"
                    className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2"
                  >
                    Email Address
                  </label>
                  <input
                    type="email"
                    id="email"
                    className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100"
                    defaultValue="john.doe@example.com"
                  />
                </div>

                <div>
                  <label
                    htmlFor="phone"
                    className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2"
                  >
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    id="phone"
                    className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100"
                    defaultValue="+1 (555) 123-4567"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Role & Permissions */}
          <div className="bg-white dark:bg-neutral-950 rounded-lg border border-neutral-200 dark:border-neutral-800">
            <div className="px-6 py-4 border-b border-neutral-200 dark:border-neutral-800">
              <h2 className="text-base font-medium text-neutral-900 dark:text-neutral-100">
                Role & Permissions
              </h2>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                    Current Role
                  </p>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    Admin
                  </p>
                </div>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400">
                  Full Access
                </span>
              </div>

              <div className="pt-2">
                <p className="text-sm text-neutral-600 dark:text-neutral-400">
                  As an admin, you have full access to all workspace features
                  and can manage team members, billing, and settings.
                </p>
              </div>
            </div>
          </div>

          {/* Security */}
          <div className="bg-white dark:bg-neutral-950 rounded-lg border border-neutral-200 dark:border-neutral-800">
            <div className="px-6 py-4 border-b border-neutral-200 dark:border-neutral-800">
              <h2 className="text-base font-medium text-neutral-900 dark:text-neutral-100">
                Security
              </h2>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                    Password
                  </p>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    Last changed 3 months ago
                  </p>
                </div>
                <button className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 cursor-default">
                  Change password
                </button>
              </div>

              <div className="flex items-center justify-between pt-4">
                <div>
                  <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                    Two-Factor Authentication
                  </p>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    Add an extra layer of security to your account
                  </p>
                </div>
                <button className="px-3 py-1.5 text-sm font-medium text-neutral-700 dark:text-neutral-300 bg-neutral-100 dark:bg-neutral-800 rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-700 cursor-default">
                  Enable
                </button>
              </div>
            </div>
          </div>

          {/* Save Button */}
          <div className="flex justify-end pt-4">
            <button className="px-4 py-2 bg-blue-600 dark:bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-neutral-900 cursor-default">
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
