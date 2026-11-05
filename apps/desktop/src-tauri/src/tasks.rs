use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskStatus {
    Queued,
    Running,
    Succeeded,
    Failed,
    Cancelled,
    Interrupted,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Task {
    pub id: String,
    pub input_version_id: String,
    pub output_version_id: Option<String>,
    pub status: TaskStatus,
}

#[derive(Debug, PartialEq, Eq)]
pub struct TaskError(&'static str);

impl fmt::Display for TaskError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.0)
    }
}

impl std::error::Error for TaskError {}

impl Task {
    pub fn queued(input_version_id: &str) -> Self {
        Self {
            id: format!("task-{input_version_id}"),
            input_version_id: input_version_id.to_owned(),
            output_version_id: None,
            status: TaskStatus::Queued,
        }
    }

    pub fn start(&mut self) -> Result<(), TaskError> {
        if self.status != TaskStatus::Queued {
            return Err(TaskError("only queued tasks can start"));
        }
        self.status = TaskStatus::Running;
        Ok(())
    }

    pub fn succeed(&mut self, output_version_id: &str) -> Result<(), TaskError> {
        if self.status != TaskStatus::Running {
            return Err(TaskError("only running tasks can succeed"));
        }
        self.output_version_id = Some(output_version_id.to_owned());
        self.status = TaskStatus::Succeeded;
        Ok(())
    }

    pub fn fail(&mut self) -> Result<(), TaskError> {
        if self.status != TaskStatus::Running {
            return Err(TaskError("only running tasks can fail"));
        }
        self.status = TaskStatus::Failed;
        Ok(())
    }

    pub fn cancel(&mut self) -> Result<(), TaskError> {
        if !matches!(self.status, TaskStatus::Queued | TaskStatus::Running) {
            return Err(TaskError("terminal tasks cannot be cancelled"));
        }
        self.status = TaskStatus::Cancelled;
        Ok(())
    }
}
