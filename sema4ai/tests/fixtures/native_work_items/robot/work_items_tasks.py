from robocorp.tasks import task
from actions import work_items


@task
def consume():
    for item in work_items.inputs:
        value = item.payload["value"]
        work_items.outputs.create(payload={"observed": value})
        item.done()
