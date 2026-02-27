/**
 * Thrown when a {@link NodeConfig} provided to {@link Watchdog.registerNode}
 * fails validation. Consumers can catch this specific class to distinguish
 * configuration errors from other runtime errors.
 */
export class WatchdogConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WatchdogConfigurationError";
    // Restore the correct prototype chain when targeting ES5.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
