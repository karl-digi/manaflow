import { RESERVED_CMUX_PORT_SET } from "@cmux/shared/utils/reserved-cmux-ports";

export type ManagedHttpService = {
  name: string;
  port: number;
  url: string;
};

export const determineHttpServiceUpdates = (
  services: readonly ManagedHttpService[],
  desiredPorts: readonly number[],
  reservedPorts: ReadonlySet<number> = RESERVED_CMUX_PORT_SET
): {
  servicesToHide: ManagedHttpService[];
  portsToExpose: number[];
  servicesToKeep: ManagedHttpService[];
} => {
  const desiredPortSet = new Set(desiredPorts);
  const manageableServices = services.filter(
    (service) =>
      service.name.startsWith("port-") && !reservedPorts.has(service.port)
  );

  const servicesToKeep = manageableServices.filter((service) =>
    desiredPortSet.has(service.port)
  );

  const existingPorts = new Set(servicesToKeep.map((service) => service.port));

  const portsToExpose = Array.from(desiredPortSet)
    .filter((port) => !existingPorts.has(port))
    .sort((a, b) => a - b);

  const servicesToHide = manageableServices.filter(
    (service) => !desiredPortSet.has(service.port)
  );

  return {
    servicesToHide,
    portsToExpose,
    servicesToKeep,
  };
};
