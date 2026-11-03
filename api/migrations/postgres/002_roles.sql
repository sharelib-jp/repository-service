INSERT INTO roles(id, name) VALUES ('admin', '管理者'), ('editor', '編集者') ON CONFLICT(id) DO NOTHING;
