from actions import action, work_items

@action
def welcome(name: str) -> str:
    """Return a greeting.

    Args:
        name: The recipient.

    Returns:
        The greeting.
    """
    greeting = f"Hello {name}"
    return greeting

@action
def consume() -> str:
    """Consume a local work item and produce a result.

    Returns:
        The observed value.
    """
    for item in work_items.inputs:
        value = item.payload["value"]
        work_items.outputs.create(payload={"observed": value})
        item.done()
        return str(value)
    raise RuntimeError("Expected a local input Work Item")
