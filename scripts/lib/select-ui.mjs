/** Drive the visible select, including the app's portalled combobox. */
export async function chooseSelect(control, selection) {
  control = control.and(control.page().getByRole("combobox"));
  if (await control.evaluate((element) => element.tagName === "SELECT")) {
    await control.selectOption(selection);
    return;
  }
  await control.click();
  const listId = await control.getAttribute("aria-controls");
  if (!listId) throw new Error("The select did not expose its option list.");
  const list = control.page().locator(`[id=${JSON.stringify(listId)}]`);
  await list.waitFor({ state: "visible" });
  const value = typeof selection === "string" ? selection : selection.value;
  const option =
    value !== undefined
      ? list.locator(`[role="option"][data-value=${JSON.stringify(value)}]`)
      : list.getByRole("option", { name: selection.label, exact: true });
  await option.waitFor({ state: "visible" });
  if ((await option.getAttribute("aria-disabled")) === "true")
    throw new Error("The requested select option is disabled.");
  await option.click();
}

export async function selectValue(control) {
  control = control.and(control.page().getByRole("combobox"));
  return (await control.evaluate((element) => element.tagName === "SELECT"))
    ? control.inputValue()
    : control.getAttribute("data-value");
}
