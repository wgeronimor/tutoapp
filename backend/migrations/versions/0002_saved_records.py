"""Protect saved learner artifacts and their immutable content versions."""

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """CREATE FUNCTION tuto_reject_saved_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'El registro guardado es definitivo; crea un nuevo intento o versión' USING ERRCODE='55000'; END $$"""
    )
    for table in ("attempts", "activities", "annotations", "reviews"):
        op.execute(
            f"CREATE TRIGGER tuto_immutable_{table} BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION tuto_reject_saved_change()"
        )
    op.execute(
        """CREATE FUNCTION tuto_protect_saved_media() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.kind='reference' OR EXISTS(SELECT 1 FROM attempts WHERE media_id=OLD.id) THEN RAISE EXCEPTION 'El audio guardado no puede modificarse ni eliminarse' USING ERRCODE='55000'; END IF; IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END $$"""
    )
    op.execute(
        "CREATE TRIGGER tuto_saved_media BEFORE UPDATE OR DELETE ON media FOR EACH ROW EXECUTE FUNCTION tuto_protect_saved_media()"
    )
    op.execute(
        """CREATE FUNCTION tuto_protect_review_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.kind='advice' AND OLD.status IN ('completed','failed') AND EXISTS(SELECT 1 FROM attempts WHERE id=OLD.payload->>'attempt_id') THEN RAISE EXCEPTION 'El comentario guardado es definitivo' USING ERRCODE='55000'; END IF; IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END $$"""
    )
    op.execute(
        "CREATE TRIGGER tuto_saved_review BEFORE UPDATE OR DELETE ON jobs FOR EACH ROW EXECUTE FUNCTION tuto_protect_review_snapshot()"
    )


def downgrade():
    raise RuntimeError(
        "La protección de registros guardados no se retira mediante una reversión automática."
    )
