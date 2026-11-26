"""Separate organization and draft removal from immutable learning records."""

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""CREATE TABLE practice_organization (
        session_id VARCHAR PRIMARY KEY REFERENCES study_sessions(id),
        hidden BOOLEAN NOT NULL DEFAULT FALSE,
        pin_order INTEGER,
        CHECK (pin_order IS NULL OR (pin_order BETWEEN 1 AND 10 AND NOT hidden)),
        UNIQUE (pin_order) DEFERRABLE INITIALLY DEFERRED
    )""")
    op.execute("""CREATE TABLE removed_proposals (
        proposal_id VARCHAR PRIMARY KEY REFERENCES proposals(id),
        created TIMESTAMPTZ NOT NULL
    )""")
    op.execute("""CREATE FUNCTION tuto_remove_draft_only() RETURNS trigger
        LANGUAGE plpgsql AS $$ DECLARE sid VARCHAR; BEGIN
        SELECT session_id INTO sid FROM proposals WHERE id=NEW.proposal_id FOR UPDATE;
        IF sid IS NOT NULL THEN
            RAISE EXCEPTION 'Solo se pueden remover propuestas nunca iniciadas'
            USING ERRCODE='55000';
        END IF;
        RETURN NEW;
    END $$""")
    op.execute("""CREATE TRIGGER tuto_remove_draft_only BEFORE INSERT ON removed_proposals
        FOR EACH ROW EXECUTE FUNCTION tuto_remove_draft_only()""")
    op.execute("""CREATE FUNCTION tuto_protect_proposal_lifecycle() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN
        IF TG_OP='DELETE' THEN
            IF OLD.session_id IS NOT NULL THEN
                RAISE EXCEPTION 'Una práctica iniciada no se elimina' USING ERRCODE='55000';
            END IF;
            RETURN OLD;
        END IF;
        IF NEW.session_id IS NOT NULL AND EXISTS(
            SELECT 1 FROM removed_proposals WHERE proposal_id=OLD.id
        ) THEN
            RAISE EXCEPTION 'La propuesta fue eliminada' USING ERRCODE='55000';
        END IF;
        IF OLD.session_id IS NOT NULL AND NEW.session_id IS DISTINCT FROM OLD.session_id THEN
            RAISE EXCEPTION 'Una práctica iniciada conserva su sesión' USING ERRCODE='55000';
        END IF;
        RETURN NEW;
    END $$""")
    op.execute("""CREATE TRIGGER tuto_proposal_lifecycle BEFORE UPDATE OR DELETE ON proposals
        FOR EACH ROW EXECUTE FUNCTION tuto_protect_proposal_lifecycle()""")
    op.execute("""CREATE TRIGGER tuto_immutable_removed_proposals
        BEFORE UPDATE OR DELETE ON removed_proposals
        FOR EACH ROW EXECUTE FUNCTION tuto_reject_saved_change()""")


def downgrade():
    raise RuntimeError("La organización y los registros de propuestas removidas deben conservarse.")
