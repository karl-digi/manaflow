import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
} from "@heroui/react";
import { Settings, Wrench } from "lucide-react";

interface CloudModeOnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onContinue: () => void;
}

export function CloudModeOnboardingModal({
  isOpen,
  onClose,
  onContinue,
}: CloudModeOnboardingModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="2xl"
      classNames={{
        base: "bg-white dark:bg-neutral-900",
        header: "border-b border-neutral-200 dark:border-neutral-800",
        body: "py-6",
        footer: "border-t border-neutral-200 dark:border-neutral-800",
      }}
    >
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
            Welcome to Cloud Mode
          </h2>
          <p className="text-sm font-normal text-neutral-500 dark:text-neutral-400">
            Set up your environment for the best experience
          </p>
        </ModalHeader>
        <ModalBody>
          <div className="space-y-6">
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
                <Settings className="w-5 h-5 text-neutral-700 dark:text-neutral-300" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-medium text-neutral-900 dark:text-neutral-100 mb-2">
                  Environment Variables
                </h3>
                <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">
                  Configure environment variables for your repositories. These
                  are encrypted at rest and injected into your cloud
                  environment. You can add API keys, database URLs, and other
                  secrets needed for your project.
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
                <Wrench className="w-5 h-5 text-neutral-700 dark:text-neutral-300" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-medium text-neutral-900 dark:text-neutral-100 mb-2">
                  Setup Scripts
                </h3>
                <div className="text-sm text-neutral-600 dark:text-neutral-400 space-y-3 leading-relaxed">
                  <p>
                    Define scripts to automate your environment setup:
                  </p>
                  <ul className="space-y-2 ml-4">
                    <li className="flex items-start gap-2">
                      <span className="text-neutral-500 dark:text-neutral-500 mt-0.5">
                        •
                      </span>
                      <div>
                        <span className="font-medium text-neutral-700 dark:text-neutral-300">
                          Maintenance script:
                        </span>{" "}
                        Runs when the environment starts (e.g., install
                        dependencies, pull Docker images)
                      </div>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-neutral-500 dark:text-neutral-500 mt-0.5">
                        •
                      </span>
                      <div>
                        <span className="font-medium text-neutral-700 dark:text-neutral-300">
                          Dev script:
                        </span>{" "}
                        Starts your development server (e.g., npm run dev, docker
                        compose up)
                      </div>
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="rounded-lg bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700 p-4">
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                <span className="font-medium text-neutral-700 dark:text-neutral-300">
                  Tip:
                </span>{" "}
                You can configure these settings in the next step. Once saved,
                your environment will be ready to use across all your cloud
                tasks.
              </p>
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button
            variant="light"
            onPress={onClose}
            className="text-neutral-600 dark:text-neutral-400"
          >
            Skip for now
          </Button>
          <Button
            color="primary"
            onPress={onContinue}
            className="bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            Continue to setup
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
