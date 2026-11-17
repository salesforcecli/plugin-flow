/*
 * Copyright 2026, Salesforce, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

export type PublicBlockingReason = { code: string; message?: string; count?: number | null };

/** Customer terminology only. The SDK retains the original platform codes and evidence. */
export const publicBlockingReason = (
  code: string | null,
  message: string | null,
  count: number | null = null
): PublicBlockingReason | null => {
  if (code === null) return null;
  const names: Record<string, string> = {
    HAS_INTERVIEWS: 'INTERVIEWS',
    PAUSED_INTERVIEWS: 'INTERVIEWS',
    FAILED_INTERVIEWS: 'INTERVIEWS',
    STORED_INTERVIEWS: 'INTERVIEWS',
    INSUFFICIENT_ACCESS: 'INSUFFICIENT_PERMISSION',
    LATEST_PACKAGED_VERSION: 'PACKAGED_VERSION',
    LAST_VERSION_PROTECTED: 'LAST_VERSION',
  };
  const customerCode = Object.hasOwn(names, code) ? names[code] : code;
  // A missing total cannot be reconstructed from message text or partial interview categories.
  const knownCount = Number.isSafeInteger(count) && count !== null && count >= 0 ? count : null;
  return {
    code: customerCode,
    ...(message === null ? {} : { message }),
    ...(customerCode === 'INTERVIEWS' || knownCount !== null ? { count: knownCount } : {}),
  };
};
