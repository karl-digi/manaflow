import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export interface GitHubPRInfo {
  owner: string;
  repo: string;
  number: string;
  isValid: boolean;
}

export function parseGitHubPRUrl(url: string): GitHubPRInfo {
  try {
    const urlObj = new URL(url);
    
    // Check if it's a GitHub URL
    if (urlObj.hostname !== 'github.com' && !urlObj.hostname.endsWith('.github.com')) {
      return { owner: '', repo: '', number: '', isValid: false };
    }

    // Parse path: /owner/repo/pull/number
    const pathParts = urlObj.pathname.split('/').filter(Boolean);
    
    if (pathParts.length < 4 || pathParts[2] !== 'pull') {
      return { owner: '', repo: '', number: '', isValid: false };
    }

    const owner = pathParts[0];
    const repo = pathParts[1];
    const number = pathParts[3];

    // Validate that number is actually a number
    if (!/^\d+$/.test(number)) {
      return { owner: '', repo: '', number: '', isValid: false };
    }

    return {
      owner,
      repo,
      number,
      isValid: true
    };
  } catch {
    return { owner: '', repo: '', number: '', isValid: false };
  }
}
