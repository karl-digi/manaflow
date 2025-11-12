/**
 * Basic usage examples for the MorphCloud client
 *
 * Note: This is an example file and is not meant to be executed directly.
 * Copy the relevant code snippets to your application.
 */

import { client } from '@cmux/morphcloud-client';

// Configure the client with your API key
client.setConfig({
  baseUrl: 'https://cloud.morph.so',
  headers: {
    Authorization: `Bearer ${process.env.MORPHCLOUD_API_KEY}`,
  },
});

// Example 1: List available images
async function listImages() {
  const { data, error } = await client.GET('/image');
  if (error) {
    console.error('Error listing images:', error);
    return;
  }
  console.log('Available images:', data);
}

// Example 2: Create a snapshot from an image
async function createSnapshot() {
  const { data, error } = await client.POST('/snapshot', {
    body: {
      image_id: 'morphvm-minimal',
      vcpus: 1,
      memory: 128,
      disk_size: 700,
      metadata: {
        purpose: 'test-environment',
      },
    },
  });

  if (error) {
    console.error('Error creating snapshot:', error);
    return;
  }

  console.log('Snapshot created:', data);
  return data;
}

// Example 3: Start an instance from a snapshot
async function startInstance(snapshotId: string) {
  const { data, error } = await client.POST('/instance', {
    query: { snapshot_id: snapshotId },
    body: {
      metadata: {
        name: 'my-instance',
      },
      ttl_seconds: 3600, // 1 hour
      ttl_action: 'stop',
    },
  });

  if (error) {
    console.error('Error starting instance:', error);
    return;
  }

  console.log('Instance started:', data);
  return data;
}

// Example 4: Execute a command in an instance
async function execCommand(instanceId: string, command: string[]) {
  const { data, error } = await client.POST('/instance/{instance_id}/exec', {
    path: { instance_id: instanceId },
    body: { command },
  });

  if (error) {
    console.error('Error executing command:', error);
    return;
  }

  console.log('Command output:', {
    stdout: data?.stdout,
    stderr: data?.stderr,
    exit_code: data?.exit_code,
  });

  return data;
}

// Example 5: Get instance details
async function getInstance(instanceId: string) {
  const { data, error } = await client.GET('/instance/{instance_id}', {
    path: { instance_id: instanceId },
  });

  if (error) {
    console.error('Error getting instance:', error);
    return;
  }

  console.log('Instance details:', data);
  return data;
}

// Example 6: Stop an instance
async function stopInstance(instanceId: string) {
  const { error } = await client.DELETE('/instance/{instance_id}', {
    path: { instance_id: instanceId },
  });

  if (error) {
    console.error('Error stopping instance:', error);
    return;
  }

  console.log('Instance stopped successfully');
}

// Example 7: List all instances with pagination
async function listInstances(page = 1, limit = 50) {
  const { data, error } = await client.GET('/instance/list', {
    query: { page, limit },
  });

  if (error) {
    console.error('Error listing instances:', error);
    return;
  }

  console.log('Instances:', {
    total: data?.total,
    page: data?.page,
    instances: data?.instances,
  });

  return data;
}

// Example workflow: Create and use an instance
async function exampleWorkflow() {
  // 1. Create a snapshot
  const snapshot = await createSnapshot();
  if (!snapshot) return;

  // Wait for snapshot to be ready
  console.log('Waiting for snapshot to be ready...');
  // In production, you'd poll the snapshot status

  // 2. Start an instance
  const instance = await startInstance(snapshot.id);
  if (!instance) return;

  // 3. Execute a command
  await execCommand(instance.id, ['echo', 'Hello from MorphCloud!']);

  // 4. Stop the instance when done
  await stopInstance(instance.id);
}

// Export examples for use in other files
export {
  listImages,
  createSnapshot,
  startInstance,
  execCommand,
  getInstance,
  stopInstance,
  listInstances,
  exampleWorkflow,
};
