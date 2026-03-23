import logging
import sys


def setup_logging(app_env: str) -> None:
    level = logging.DEBUG if app_env.lower() == "development" else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
    )

