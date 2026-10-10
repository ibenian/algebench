-- PostgreSQL schema for the concrete sample; apply once before starting services.
CREATE TABLE followers (
    source text NOT NULL,
    target text NOT NULL,
    PRIMARY KEY (source, target)
);
CREATE TABLE notifications (id text PRIMARY KEY, payload jsonb NOT NULL);
CREATE TABLE outbox (
    id text PRIMARY KEY,
    topic text NOT NULL,
    payload jsonb NOT NULL,
    due_at timestamptz NOT NULL DEFAULT now(),
    published boolean NOT NULL DEFAULT false
);
CREATE INDEX outbox_due ON outbox(due_at, id) WHERE NOT published;
CREATE TABLE completed (id text PRIMARY KEY);
CREATE TABLE terminal (id text PRIMARY KEY);
INSERT INTO followers(source, target) VALUES
    ('publisher-1', 'u1'), ('publisher-1', 'u2'), ('publisher-1', 'u3'),
    ('channel-2', 'u2'), ('channel-2', 'u4');
