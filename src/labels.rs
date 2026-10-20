use crate::wire::Tag;

pub fn tags(labels: &[Tag]) -> String {
    labels
        .iter()
        .map(|l| l.name.as_str())
        .collect::<Vec<_>>()
        .join(", ")
}
