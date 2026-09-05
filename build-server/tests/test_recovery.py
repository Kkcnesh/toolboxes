from db import BuildFix
from pipeline import recovery


class _ExplodingClient:
    """Any call means the fix knowledge base wasn't checked first."""

    def post(self, *args, **kwargs):
        raise AssertionError("The LLM should not be called when a known fix already exists")


def test_known_fix_is_returned_without_calling_the_llm(db_session):
    error_log = "ERROR: No matching distribution found for foobar==1.2.3\nmore output here"
    fingerprint = recovery.fingerprint_error(error_log)

    db_session.add(
        BuildFix(
            error_fingerprint=fingerprint,
            fix_type="pip_flag",
            fix_payload={"flag": "--pre"},
            success_count=3,
            failure_count=0,
        )
    )
    db_session.commit()

    fix, came_from_kb = recovery.get_fix(db_session, error_log, {}, client=_ExplodingClient())

    assert came_from_kb is True
    assert fix.fix_type == "pip_flag"
    assert fix.fix_payload == {"flag": "--pre"}


def test_fix_with_more_failures_than_successes_is_not_reused(db_session):
    error_log = "ERROR: some other failure\nmore output"
    fingerprint = recovery.fingerprint_error(error_log)

    db_session.add(
        BuildFix(
            error_fingerprint=fingerprint,
            fix_type="retry",
            fix_payload={},
            success_count=0,
            failure_count=2,
        )
    )
    db_session.commit()

    known = recovery.lookup_known_fix(db_session, fingerprint)

    assert known is None


def test_record_fix_outcome_upserts_success_and_failure_counts(db_session):
    recovery.record_fix_outcome(db_session, "fp-1", "add_apt_package", {"packages": ["libgl1"]}, success=True)
    recovery.record_fix_outcome(db_session, "fp-1", "add_apt_package", {"packages": ["libgl1"]}, success=False)
    db_session.commit()

    row = db_session.query(BuildFix).filter_by(error_fingerprint="fp-1", fix_type="add_apt_package").one()

    assert row.success_count == 1
    assert row.failure_count == 1


def test_fingerprint_is_stable_for_the_same_first_line():
    log_a = "ModuleNotFoundError: No module named 'foo'\nTraceback stuff\n"
    log_b = "ModuleNotFoundError: No module named 'foo'\na completely different rest of the log"

    assert recovery.fingerprint_error(log_a) == recovery.fingerprint_error(log_b)
