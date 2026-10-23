from actions import action, work_items


@action
def consume() -> str:
    """Consume a synthetic Work Item and create an output with real lineage.

    Returns:
        The observed value.
    """
    for item in work_items.inputs:
        value = item.payload["value"]
        work_items.outputs.create(payload={"observed": value})
        item.done()
        return str(value)
    raise RuntimeError("Expected a Work Item")
