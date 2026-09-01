"""The two failure classes, and why the distinction is the whole design.

SQS redelivers on an unhandled exception, so "raise" means "try again". That
is right for a database that is briefly unreachable and wrong for a file that
will not decode: the second would burn three receives and land in the
dead-letter queue as though something were broken, when the correct outcome is
a FAILED asset a reviewer can look at and a message that is finished with.
"""


class TerminalError(Exception):
    """The asset cannot be processed, and retrying will not change that.

    The message is acknowledged and the row is marked FAILED with this text,
    which is what a reviewer reads.
    """


class TransientError(Exception):
    """Something outside this asset failed. Retrying may well work.

    Raised onward so SQS redelivers, unless the attempt ceiling has been
    reached — see handler.process_record.
    """
