"""Initial immutable PostgreSQL schema."""

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None
SQL = [
    "CREATE TABLE activities (\n\tid VARCHAR NOT NULL, \n\tkey VARCHAR NOT NULL, \n\tversion VARCHAR NOT NULL, \n\tdata JSONB NOT NULL, \n\tPRIMARY KEY (id), \n\tUNIQUE (key, version)\n)",
    "CREATE TABLE classes (\n\tid VARCHAR NOT NULL, \n\tdata JSONB NOT NULL, \n\tPRIMARY KEY (id)\n)",
    "CREATE TABLE jobs (\n\tid VARCHAR NOT NULL, \n\tkind VARCHAR NOT NULL, \n\tstatus VARCHAR NOT NULL, \n\tpayload JSONB NOT NULL, \n\tresult JSONB NOT NULL, \n\terror TEXT, \n\tcreated TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id)\n)",
    "CREATE TABLE media (\n\tid VARCHAR NOT NULL, \n\tpath VARCHAR NOT NULL, \n\tkind VARCHAR NOT NULL, \n\tinfo JSONB NOT NULL, \n\tcreated TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id)\n)",
    "CREATE TABLE memory (\n\tid VARCHAR NOT NULL, \n\titem VARCHAR NOT NULL, \n\tskill VARCHAR NOT NULL, \n\tlabel VARCHAR NOT NULL, \n\tcard JSONB NOT NULL, \n\tdue TIMESTAMP WITH TIME ZONE NOT NULL, \n\tevidence JSONB NOT NULL, \n\tPRIMARY KEY (id)\n)",
    "CREATE TABLE settings (\n\tid INTEGER NOT NULL, \n\tdata JSONB NOT NULL, \n\tPRIMARY KEY (id)\n)",
    "CREATE TABLE study_sessions (\n\tid VARCHAR NOT NULL, \n\tkey VARCHAR NOT NULL, \n\ttitle VARCHAR NOT NULL, \n\tsource VARCHAR NOT NULL, \n\tactivity_ids JSONB NOT NULL, \n\tstate JSONB NOT NULL, \n\tcreated TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tUNIQUE (key)\n)",
    "CREATE TABLE attempts (\n\tid VARCHAR NOT NULL, \n\tsession_id VARCHAR NOT NULL, \n\tactivity_id VARCHAR NOT NULL, \n\tmedia_id VARCHAR, \n\tresponse TEXT NOT NULL, \n\tevidence JSONB NOT NULL, \n\tresult JSONB NOT NULL, \n\tcreated TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(session_id) REFERENCES study_sessions (id), \n\tFOREIGN KEY(activity_id) REFERENCES activities (id), \n\tFOREIGN KEY(media_id) REFERENCES media (id)\n)",
    "CREATE TABLE proposals (\n\tid VARCHAR NOT NULL, \n\tparent_id VARCHAR, \n\ttopic TEXT NOT NULL, \n\tpreferences JSONB NOT NULL, \n\tinstruction TEXT NOT NULL, \n\tdata JSONB NOT NULL, \n\tsession_id VARCHAR, \n\tcreated TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(parent_id) REFERENCES proposals (id), \n\tFOREIGN KEY(session_id) REFERENCES study_sessions (id)\n)",
    "CREATE TABLE annotations (\n\tid VARCHAR NOT NULL, \n\tattempt_id VARCHAR NOT NULL, \n\ttext TEXT NOT NULL, \n\torigin VARCHAR NOT NULL, \n\tcreated TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(attempt_id) REFERENCES attempts (id)\n)",
    "CREATE TABLE reviews (\n\tid VARCHAR NOT NULL, \n\tmemory_id VARCHAR NOT NULL, \n\tattempt_id VARCHAR NOT NULL, \n\tdata JSONB NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(memory_id) REFERENCES memory (id), \n\tUNIQUE (attempt_id), \n\tFOREIGN KEY(attempt_id) REFERENCES attempts (id)\n)",
]


def upgrade():
    for statement in SQL:
        op.execute(statement)


def downgrade():
    raise RuntimeError(
        "Reversión destructiva: requiere una migración explícita y exportación previa."
    )
