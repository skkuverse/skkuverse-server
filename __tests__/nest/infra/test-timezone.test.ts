/**
 * Every Jest worker runs in UTC whatever the host's zone (`jest.config.js`,
 * harden-test-suite design D5), so code that needs KST has to name
 * `Asia/Seoul` itself.
 */
describe("the test time zone", () => {
  it("puts the epoch at offset zero", () => {
    // Act
    const offsetMinutes = new Date(0).getTimezoneOffset();

    // Assert
    expect(offsetMinutes).toBe(0);
  });

  it("resolves Intl's default zone to UTC", () => {
    // Act
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    // Assert
    expect(zone).toBe("UTC");
  });

  it("reads a KST midnight's local date as the previous day", () => {
    // Arrange
    const kstMidnight = new Date("2026-10-20T00:00:00+09:00");

    // Act
    const localDate = kstMidnight.getDate();

    // Assert
    expect(localDate).toBe(19);
  });
});
